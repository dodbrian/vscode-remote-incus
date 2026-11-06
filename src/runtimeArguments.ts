import { applyEdits, modify, parseTree, type ParseError } from 'jsonc-parser';

/** Return a minimal JSONC edit, refusing ambiguous or malformed configuration. */
export function enableProposedApi(text: string, extensionId: string): string {
  const errors: ParseError[] = [];
  const root = parseTree(text, errors, { allowTrailingComma: true });
  if (errors.length || root?.type !== 'object') {
    throw new Error('Runtime arguments must be a valid JSON object. Fix argv.json and try again.');
  }
  const properties =
    root.children?.filter((node) => node.children?.[0]?.value === 'enable-proposed-api') ?? [];
  if (properties.length > 1) throw new Error('Remove duplicate enable-proposed-api entries first.');
  const value = properties[0]?.children?.[1];
  if (value && (value.type !== 'array' || value.children?.some((node) => node.type !== 'string'))) {
    throw new Error('enable-proposed-api must be an array of extension IDs.');
  }
  const ids = value?.children?.map((node) => node.value as string) ?? [];
  if (ids.some((id) => id.toLowerCase() === extensionId.toLowerCase())) return text;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return applyEdits(
    text,
    modify(text, ['enable-proposed-api', -1], extensionId, {
      formattingOptions: { insertSpaces: true, tabSize: 2, eol },
    }),
  );
}
