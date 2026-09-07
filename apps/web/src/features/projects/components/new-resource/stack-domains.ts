/**
 * One hostname for the stack; the other public services derive from it.
 *
 * A stack has one address a human types and, occasionally, a second surface
 * that also has to be reachable (openstatus's status page next to its
 * dashboard). Asking for a hostname per service scales the wrong way: the
 * answer is nearly always "name them after the stack", so the wizard asks
 * once and derives the rest.
 *
 * Derived names are FLAT SIBLINGS, not nested subdomains. `status.<base>`
 * would put the status page a level deeper than the stack, and a wildcard
 * certificate matches exactly ONE label — `*.example.com` covers
 * `acme.example.com` and does NOT cover `status.acme.example.com`. Every
 * install that terminates TLS on a wildcard would get a working dashboard and
 * a status page that fails its handshake. So the service name joins the
 * FIRST LABEL with a dash and the zone underneath is untouched:
 *
 *   base                      acme.example.com
 *   front door (dashboard)  → acme.example.com
 *   status-page             → acme-status-page.example.com
 *
 * Every derived row stays individually editable; this only decides what they
 * start as.
 */

/** Split a hostname into its first label and everything under it. */
function splitHost(host: string): { first: string; zone: string } {
  const dot = host.indexOf(".");
  return dot === -1
    ? { first: host, zone: "" }
    : { first: host.slice(0, dot), zone: host.slice(dot + 1) };
}

/**
 * The hostname `service` should start at, given the stack's base hostname.
 *
 * The front door IS the base — that is what makes it the front door. An empty
 * base derives nothing rather than a bare `-status-page`, because empty means
 * "no opinion, let the server generate one".
 */
export function deriveStackDomain(base: string, service: string, isFront: boolean): string {
  const trimmed = base.trim();
  if (trimmed === "") return "";
  if (isFront) return trimmed;

  const { first, zone } = splitHost(trimmed);
  // Already carries this service's name (someone typed `acme-status-page` as
  // the base): joining again would read `acme-status-page-status-page`.
  const label = first === service || first.endsWith(`-${service}`) ? first : `${first}-${service}`;
  return zone === "" ? label : `${label}.${zone}`;
}
