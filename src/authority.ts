/**
 * Remote authority format for this extension.
 *
 *   `incus+<remote>:<instance>`   explicit remote
 *   `incus+<instance>`            the client's default remote (resolved lazily)
 *
 * The separator between remote and instance is `:` (mirroring the incus CLI's
 * `<remote>:<instance>` addressing) and deliberately NOT `/`: the authority
 * component of a `vscode-remote://` URI ends at the first slash, so anything
 * after a slash would leak into the URI path and be invisible to the resolver.
 * Incus remote and instance names cannot contain `:`, so the split is total.
 * The Remote Explorer switcher keys on the authority prefix `incus`
 * (`authority.split('+')[0]`) — verified in the spike (DESIGN.md §8).
 */
export const AUTHORITY_PREFIX = 'incus';

export interface ParsedAuthority {
  remote?: string;
  instance: string;
}

export function parseAuthority(authority: string): ParsedAuthority {
  const prefix = `${AUTHORITY_PREFIX}+`;
  if (!authority.startsWith(prefix)) {
    throw new Error(`unsupported authority "${authority}" (expected "${prefix}<remote>:<instance>")`);
  }
  const rest = authority.slice(prefix.length);
  const sep = rest.indexOf(':');
  return sep === -1
    ? { instance: rest }
    : { remote: rest.slice(0, sep), instance: rest.slice(sep + 1) };
}

export function formatAuthority(ref: { remote?: string; instance: string }): string {
  return ref.remote
    ? `${AUTHORITY_PREFIX}+${ref.remote}:${ref.instance}`
    : `${AUTHORITY_PREFIX}+${ref.instance}`;
}
