/**
 * Reduce whatever an operator typed into a URL-ish field to the bare
 * hostname it names, or null when nothing host-like survives. Tolerates a
 * scheme, a path, a query/fragment, a :port, and stray whitespace — the
 * shapes address env vars (`https://netbird.acme.com/`) actually arrive in.
 *
 * Shared between the compose wizard (which turns an edited address variable
 * into the exposed service's public domain) and the API's exposed-seed
 * normalizer, so the two ends of that hand-off cannot drift. Deliberately
 * loose: the API re-validates against its full FQDN rules afterwards.
 */
export function stripToHostname(value: string): string | null {
  let s = value.trim().toLowerCase();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  const cut = s.search(/[/?#]/);
  if (cut !== -1) s = s.slice(0, cut);
  // Strip a :port suffix; IPv6 literals aren't valid hosts here and are left
  // to fail the caller's stricter validation on their own.
  s = s.replace(/:\d+$/, "");
  return s.includes(".") && /^[a-z0-9.-]+$/.test(s) ? s : null;
}
