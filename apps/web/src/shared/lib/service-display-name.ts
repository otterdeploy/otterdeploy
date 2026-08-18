/**
 * Strip platform naming machinery from a swarm service / container name for
 * DISPLAY. The machine name (`od-<project>-<service>`, legacy
 * `otterdeploy-<engine>-<project>-<name>`) is load-bearing: it's the unique
 * per-daemon identity, the DNS address Caddy dials, and what route validation
 * authenticates: so it never changes; but a human reading a list next to a
 * project badge doesn't need to re-read the prefix and project in every row.
 *
 * Always keep the RAW name in search keywords and in any payload sent back to
 * the server (exec targets address containers by the machine name).
 */

const MACHINE_PREFIXES = ["od-", "otterdeploy-svc-", "otterdeploy-"];

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function serviceDisplayName(raw: string, projectSlug?: string | null): string {
  let name = raw;
  for (const prefix of MACHINE_PREFIXES) {
    if (name.startsWith(prefix)) {
      name = name.slice(prefix.length);
      break;
    }
  }
  if (projectSlug) {
    // Legacy database names carry an engine segment before the project
    // (`pg-<project>-<name>`); the optional leading group absorbs it.
    const match = new RegExp(`^(?:[a-z0-9]+-)?${escapeRegExp(projectSlug)}-(.+)$`).exec(name);
    if (match?.[1]) return match[1];
  }
  return name;
}
