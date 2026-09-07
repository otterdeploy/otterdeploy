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

/** The service half of an `<service>:<port>` exposure key. */
export function serviceOf(key: string): string {
  return key.split(":")[0] ?? key;
}

/** The port half. "" when the key carries none. */
function portOf(key: string): string {
  return key.split(":")[1] ?? "";
}

export interface DomainRow {
  /** `<service>:<port>`, the same key `file.exposed` uses. */
  key: string;
  domain: string;
  /** The operator typed this one; the front door no longer drives it. */
  custom: boolean;
}

/**
 * Rewrite the derived rows after the FRONT DOOR's hostname changed.
 *
 * Row 0 is the front door — `file.exposed` is ordered front-door-first — so
 * it IS the stack's name and there is no separate base field to keep in sync.
 * Pinned rows are left exactly as they are.
 */
export function rederiveDomains(rows: readonly DomainRow[], base: string): DomainRow[] {
  // A container can publish more than one port, and each published port is a
  // route of its own. Naming both after the service alone would derive ONE
  // hostname for two routes, so the port joins the label whenever a service
  // appears more than once.
  const perService = new Map<string, number>();
  for (const row of rows) {
    const service = serviceOf(row.key);
    perService.set(service, (perService.get(service) ?? 0) + 1);
  }

  return rows.map((row, i) => {
    if (i === 0) return { ...row, domain: base };
    if (row.custom) return row;
    const service = serviceOf(row.key);
    const label = (perService.get(service) ?? 0) > 1 ? `${service}-${portOf(row.key)}` : service;
    return { ...row, domain: deriveStackDomain(base, label, false) };
  });
}
