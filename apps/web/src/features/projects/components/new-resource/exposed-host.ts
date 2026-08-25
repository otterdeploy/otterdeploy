/**
 * The wizard-side half of "the URL you typed is the URL you get".
 *
 * The compose wizard auto-fills address-shaped variables (`NETBIRD_DOMAIN`,
 * `SERVER_URL`, …) with the stack's resolved public host and remembers that
 * seed on the row (`Var.seedValue`). If the operator edits such a value, the
 * hostname they typed becomes the exposed front service's public domain in
 * the staged manifest entry — otherwise the route would publish on the
 * name-derived generated host while the app's own config points elsewhere.
 */

/** The hostname the operator typed over a seeded address variable, or null
 *  when every seed is untouched (the generated host stays canonical). */
export function editedExposedHost(
  vars: Array<{ value: string; seedValue?: string }>,
): string | null {
  for (const v of vars) {
    if (v.seedValue === undefined || v.value.trim() === "" || v.value === v.seedValue) continue;
    const host = extractHostname(v.value);
    if (host) return host;
  }
  return null;
}

/** Bare hostname out of whatever shape the operator typed into a URL-ish
 *  field (scheme, path, port, trailing slash). Loose on purpose: the server
 *  re-normalizes and falls back to the generated host if nothing usable
 *  survives. */
export function extractHostname(value: string): string | null {
  let s = value.trim().toLowerCase();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  const cut = s.search(/[/?#]/);
  if (cut !== -1) s = s.slice(0, cut);
  s = s.replace(/:\d+$/, "");
  return s.includes(".") && /^[a-z0-9.-]+$/.test(s) ? s : null;
}
