'use strict';

const path = require('node:path');
const MarkdownIt = require('markdown-it');
const { parseFragment } = require('parse5');

// Markdown-it owns syntax recognition. The only source mapping here locates its
// recognized destination spans so rewriting preserves titles and surrounding text.
function parseMarkdown(text) {
  const md = new MarkdownIt({ html: true, linkify: false, typographer: false });
  let normalized = '';
  const rawOffsets = [];
  for (let index = 0; index < text.length; index++) {
    rawOffsets.push(index);
    const char = text[index];
    normalized += char === '\r' ? '\n' : char === '\0' ? '\ufffd' : char;
    if (char === '\r' && text[index + 1] === '\n') index++;
  }
  rawOffsets.push(text.length);
  const lines = normalized.split('\n');
  const lineStarts = [];
  let lineOffset = 0;
  for (const line of lines) {
    lineStarts.push(lineOffset);
    lineOffset += line.length + 1;
  }
  const spans = [];
  let active = null;
  let inlineMap = null;
  const originalDestination = md.helpers.parseLinkDestination;
  md.helpers.parseLinkDestination = (source, start, max) => {
    const result = originalDestination(source, start, max);
    if (result.ok && active) {
      const angle = source[start] === '<';
      active.push({
        start: start + (angle ? 1 : 0),
        end: result.pos - (angle ? 1 : 0),
        href: result.str,
        source,
        map: inlineMap,
      });
    }
    return result;
  };
  // Rule wrappers deliberately use the locked parser's named rule registry;
  // accepting only successful non-silent rules avoids rewriting code or examples.
  for (const [ruler, names] of [
    [md.inline.ruler, ['link', 'image']],
    [md.block.ruler, ['reference']],
  ]) {
    for (const name of names) {
      const original = ruler.__rules__.find((rule) => rule.name === name).fn;
      ruler.at(name, (...args) => {
        const previous = active;
        const captured = [];
        active = captured;
        const result = original(...args);
        active = previous;
        const silent = name === 'reference' ? args[3] : args[1];
        if (result && !silent) spans.push(...captured);
        return result;
      });
    }
  }
  md.core.ruler.at('inline', (state) => {
    let currentLine = 0;
    const cursors = new Map();
    for (const token of state.tokens) {
      if (token.map) currentLine = token.map[0];
      if (token.type !== 'inline') continue;
      const contentLines = token.content.split('\n');
      inlineMap = contentLines.map((content, index) => {
        const line = currentLine + index;
        const offset = lines[line]?.indexOf(content, cursors.get(line) ?? 0) ?? -1;
        if (offset < 0) return null;
        cursors.set(line, offset + content.length);
        return lineStarts[line] + offset;
      });
      state.md.inline.parse(token.content, state.md, state.env, token.children);
      inlineMap = null;
    }
  });
  md.parse(normalized, {});
  const destinations = spans.map((span) => {
    const position = (offset) => {
      if (!span.map) return rawOffsets[offset];
      const prefix = span.source.slice(0, offset).split('\n');
      const base = span.map[prefix.length - 1];
      if (base === null || base === undefined)
        throw new Error('Cannot safely map Markdown destination to source');
      return rawOffsets[base + prefix.at(-1).length];
    };
    return {
      href: span.href,
      sourcePosition: () => ({ start: position(span.start), end: position(span.end) }),
    };
  });
  return { destinations };
}

function inspectMarkdown(text) {
  const md = new MarkdownIt({ html: true, linkify: false, typographer: false });
  const tokens = md.parse(text, {});
  const links = [];
  const anchors = new Set();
  const headings = new Set();
  function addAnchor(content) {
    const slug = content
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}_ -]/gu, '')
      .replace(/ /g, '-');
    let anchor = slug;
    let suffix = 0;
    while (headings.has(anchor)) anchor = `${slug}-${++suffix}`;
    headings.add(anchor);
    anchors.add(anchor);
  }
  function htmlAnchors(node) {
    for (const attr of node.attrs ?? []) {
      if (attr.name === 'id' || (node.tagName === 'a' && attr.name === 'name'))
        anchors.add(attr.value);
    }
    for (const child of node.childNodes ?? []) htmlAnchors(child);
  }
  function visit(token) {
    if (token.type === 'link_open') links.push(token.attrGet('href'));
    if (token.type === 'image') links.push(token.attrGet('src'));
    if (token.type === 'html_inline' || token.type === 'html_block') {
      htmlAnchors(parseFragment(token.content));
    }
    if (token.children) for (const child of token.children) visit(child);
  }
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type === 'heading_open') {
      const children = tokens[index + 1]?.children ?? [];
      addAnchor(
        children
          .filter((child) => ['text', 'code_inline', 'image'].includes(child.type))
          .map((child) => child.content)
          .join(''),
      );
    }
    visit(token);
  }
  return { links, anchors };
}

function resolveLocalLink(name, href) {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) return null;
  const hash = href.indexOf('#');
  const fragment = hash < 0 ? '' : decodeURIComponent(href.slice(hash + 1));
  const file = decodeURIComponent(href.split(/[?#]/)[0]);
  if (file.startsWith('/') || file.includes('\\'))
    throw new Error('Absolute or backslash local link');
  return {
    target: file ? path.posix.normalize(path.posix.join(path.posix.dirname(name), file)) : name,
    fragment,
  };
}

function rewriteMarkdownLinks(text, replacement) {
  const { destinations } = parseMarkdown(text);
  const edits = new Map();
  for (const span of destinations) {
    const href = replacement(span.href);
    if (href === null || href === undefined || href === span.href) continue;
    const { start, end } = span.sourcePosition();
    if (start === undefined || end === undefined || start > end) {
      throw new Error('Cannot safely map Markdown destination to source');
    }
    edits.set(`${start}:${end}`, { start, end, href });
  }
  let output = text;
  for (const { start, end, href } of [...edits.values()].sort((a, b) => b.start - a.start)) {
    output = output.slice(0, start) + href + output.slice(end);
  }
  const count = edits.size;
  return { text: output, count };
}

module.exports = { inspectMarkdown, resolveLocalLink, rewriteMarkdownLinks };
