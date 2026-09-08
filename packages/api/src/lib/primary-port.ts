/**
 * Which port is the primary one, when nobody said.
 *
 * A service's `primary` flag is optional at every boundary: the manifest marks
 * it `.optional()`, and the create form lets you add a port without choosing.
 * Something therefore has to decide, and the rule is "the first HTTP port".
 *
 * The rule existed already, but only on the WRITE path (`normalizePorts`). The
 * diff had its own reading of an omitted flag, `primary ?? false`, and the two
 * disagreeing is a permanent phantom update: the manifest omits `primary`, the
 * diff says the port must become non-primary, apply writes it through
 * `normalizePorts` which promotes it straight back, and the next diff proposes
 * the identical change forever. Round-tripping the manifest (read, edit one
 * field, write) also silently demoted the primary port, which breaks routing
 * (od-8kqp).
 *
 * So the rule lives here, once, and both sides call it. Pure and
 * order-sensitive by design: "first" means first in the declared array, which
 * is the order the operator wrote and the order the rows preserve.
 */

/** The minimum a port needs for the rule to apply to it. */
export interface PrimaryCandidate {
  appProtocol: "http" | "tcp";
  isPrimary: boolean;
}

/**
 * Return `ports` with exactly one primary HTTP port, promoting the first one
 * when the caller flagged none.
 *
 * No-ops when there are no HTTP ports (a TCP-only service has no primary, and
 * inventing one would route traffic at a port that cannot serve it) and when a
 * primary is already flagged (the operator's choice wins, and a second flagged
 * primary is left alone rather than silently demoted here: that is the
 * validation layer's business, not this rule's).
 */
export function withPromotedPrimary<T extends PrimaryCandidate>(ports: readonly T[]): T[] {
  if (ports.some((p) => p.isPrimary)) return [...ports];

  const first = ports.findIndex((p) => p.appProtocol === "http");
  if (first === -1) return [...ports];

  return ports.map((p, i) => (i === first ? { ...p, isPrimary: true } : p));
}
