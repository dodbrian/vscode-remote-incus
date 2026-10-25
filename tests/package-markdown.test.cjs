'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  inspectMarkdown,
  resolveLocalLink,
  rewriteMarkdownLinks,
} = require('../scripts/package-markdown.cjs');
const { finalizeRecords } = require('../scripts/finalize-package.cjs');

function finalize(text, name = 'extension/docs/README.md') {
  return finalizeRecords(new Map([[name, Buffer.from(text)]]))
    .get(name)
    .toString();
}

test('Markdown parser sees inline, image, reference, collapsed and shortcut links', () => {
  const source =
    '[inline](a.md) ![image](icon.svg) [ref][id] [collapsed][] [shortcut]\n\n[id]: <b.md#topic> "title"\n[collapsed]: c.md\n[shortcut]: d.md';
  assert.deepEqual(inspectMarkdown(source).links, [
    'a.md',
    'icon.svg',
    'b.md#topic',
    'c.md',
    'd.md',
  ]);
});

test('fences, indented code and inline code remain examples with both fence styles', () => {
  const source =
    '~~~md\n[example](missing.md)\n[id]: bad.md\n~~~\n\n```md\n[example](missing.md)\n```\n\n    [indented](missing.md)\n\n`[inline](missing.md)` [actual](ok.md)';
  assert.deepEqual(inspectMarkdown(source).links, ['ok.md']);
  assert.equal(
    rewriteMarkdownLinks(source, () => 'changed.md').text,
    source.replace('[actual](ok.md)', '[actual](changed.md)'),
  );
});

test('heading anchors use rendered text, setext headings, duplicates and same-file fragments', () => {
  const parsed = inspectMarkdown(
    '# **Hello** `code` [world](a.md)\n\nHello code world\n===\n\n[second](#hello-code-world-1)\n\n~~~\n# Hidden\n~~~',
  );
  assert.deepEqual([...parsed.anchors], ['hello-code-world', 'hello-code-world-1']);
  assert.deepEqual(resolveLocalLink('extension/readme.md', '#hello-code-world-1'), {
    target: 'extension/readme.md',
    fragment: 'hello-code-world-1',
  });
});

test('local resolution decodes paths and fragments, preserves query semantics and ignores URLs', () => {
  assert.deepEqual(
    resolveLocalLink('extension/docs/README.md', '../%52EADME.md?view=1#some%20heading'),
    { target: 'extension/README.md', fragment: 'some heading' },
  );
  assert.equal(resolveLocalLink('extension/readme.md', 'https://example.invalid/a.md'), null);
  assert.equal(resolveLocalLink('extension/readme.md', '//example.invalid/a.md'), null);
  assert.throws(() => resolveLocalLink('extension/readme.md', 'bad%GG.md'), URIError);
  assert.throws(() => resolveLocalLink('extension/readme.md', '/absolute.md'));
});

test('finalization rewrites inline and reference aliases, encoded destinations and titles', () => {
  const source =
    '[root](<../%52EADME.md#heading> "Title") [license](../LICENSE)\n\n[ref][id]\n\n[id]: <../README.md?view=1#heading> \'Reference title\'\n';
  const output = finalize(source);
  assert.equal(
    output,
    '[root](<../readme.md#heading> "Title") [license](../LICENSE.txt)\n\n[ref][id]\n\n[id]: <../readme.md?view=1#heading> \'Reference title\'\n',
  );
  assert.equal(finalize(output), output);
});

test('finalization preserves code, external links, unrecognized text and original line endings', () => {
  const source =
    '~~~md\r\n[example](../README.md)\r\n~~~\r\n\r\n`[code](../README.md)` [external](https://example.invalid/README.md) [root](../README.md)\r\n';
  assert.equal(finalize(source), source.replace('[root](../README.md)', '[root](../readme.md)'));
});

test('parsed destination positions preserve quotes, lists, tables and repeated text', () => {
  const source =
    '> [same](../README.md)\n\n- [same](../README.md)\n\n| One | Two |\n| --- | --- |\n| [same](../README.md) | [same](../README.md) |';
  assert.equal(finalize(source), source.replaceAll('../README.md', '../readme.md'));
});

test('unused reference definitions normalize without touching invalid link examples', () => {
  const source = '[unused]: ../%52EADME.md "title"\n\n[invalid](../README.md "missing end"\n';
  assert.equal(finalize(source), source.replace('../%52EADME.md', '../readme.md'));
});

test('nested containers and multiline references preserve source positions', () => {
  const source =
    '> - [one](../README.md)\n>   continued [two](../README.md)\n\n- [ref][id]\n\n[id]:\n  <../%52EADME.md#heading>\n  "multiline title"\n';
  assert.deepEqual(inspectMarkdown(source).links, [
    '../README.md',
    '../README.md',
    '../%52EADME.md#heading',
  ]);
  assert.equal(
    finalize(source),
    source.replaceAll('../README.md', '../readme.md').replace('../%52EADME.md', '../readme.md'),
  );
});

test('HTML anchors use actual attributes without parsing comments or script examples', () => {
  const source =
    '<a class="example" id="some&gt;anchor" name="legacy"></a>\n\n<!-- <a id="fake-comment"> -->\n\n<script>const example = \'<a id="fake-script">\';</script>\n\n<a data-id="fake-data"></a>';
  assert.deepEqual([...inspectMarkdown(source).anchors], ['some>anchor', 'legacy']);
});
