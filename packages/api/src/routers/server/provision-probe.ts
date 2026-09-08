/**
 * The pre-flight probe: what a host tells us about itself before we change
 * anything on it.
 *
 * Split out of ./provision.ts when the probe grew past the OS and docker
 * version. It now also answers the two questions that decide whether our node
 * edge proxy can be installed at all: is anything already listening on 80/443,
 * and is another deploy platform running here (od-u05r).
 *
 * Every builder is PURE and every parser TOLERANT. This runs against a host we
 * do not control, whose login may print a banner, whose docker may not exist
 * and whose `ss` may be missing. Each of those has to degrade to "could not
 * tell" rather than abort a join.
 */

export type Privilege = "root" | "sudo" | "none";

export interface ProbeResult {
  osId: string;
  /** The host's own `hostname`. How it will appear in `docker node ls`, so the
   *  manager-side verify step can find the freshly-joined node. */
  hostname: string;
  privilege: Privilege;
  /** Docker server version, or "none" if not installed. */
  docker: string;
  /** Swarm LocalNodeState: "active" | "inactive" | "unknown". */
  swarmState: string;
  /**
   * What already listens on the edge ports, as (port, holder) pairs.
   *
   * Empty on a fresh box. Non-empty means something else owns 80/443 - most
   * often another deploy platform's proxy - and installing ours there fails
   * with "port is already allocated" (od-u05r).
   */
  edgePortHolders: EdgePortHolder[];
  /**
   * Raw `docker ps` output, for `parseRemoteContainers` + `matchPlatforms`.
   *
   * Carried rather than parsed here so the platform-detection RULES stay in
   * one place (routers/migrate). Provisioning growing its own opinion about
   * what Coolify looks like is exactly how the two would drift.
   */
  containerList: string;
}

/** A listener already bound to one of the edge ports. */
export interface EdgePortHolder {
  port: number;
  /** Container name where docker could name one, else "unknown". Shown to the
   *  operator, so it has to name something they can act on. */
  holder: string;
}

// ─── pure script builders ───────────────────────────────────────────────────

/** Emit `OTTER_<KEY>=<value>` markers we parse back in `parseProbe`. Tolerant:
 *  every probe is best-effort so a missing tool never aborts the whole script. */
export function probeScript(): string {
  return [
    "set +e",
    ". /etc/os-release 2>/dev/null || true",
    'echo "OTTER_OS_ID=${ID:-unknown}"',
    'echo "OTTER_HOSTNAME=$(hostname 2>/dev/null || echo unknown)"',
    'if [ "$(id -u)" = "0" ]; then echo "OTTER_PRIV=root";',
    'elif sudo -n true 2>/dev/null; then echo "OTTER_PRIV=sudo";',
    'else echo "OTTER_PRIV=none"; fi',
    'if command -v docker >/dev/null 2>&1; then echo "OTTER_DOCKER=$(docker version --format "{{.Server.Version}}" 2>/dev/null || echo present)"; else echo "OTTER_DOCKER=none"; fi',
    'echo "OTTER_SWARM=$(docker info --format "{{.Swarm.LocalNodeState}}" 2>/dev/null || echo unknown)"',
    // Who holds the edge ports. Docker first, because it can name the
    // CONTAINER, which is what the operator can act on ("coolify-proxy", not a
    // pid). `ss` then catches a holder docker knows nothing about: a host
    // nginx, a stray systemd unit.
    'docker ps --format "{{.Names}} {{.Ports}}" 2>/dev/null | while read -r n p; do',
    '  case "$p" in *:80->*|*:80/tcp*) echo "OTTER_PORT80=$n";; esac',
    '  case "$p" in *:443->*|*:443/tcp*) echo "OTTER_PORT443=$n";; esac',
    "done",
    "if command -v ss >/dev/null 2>&1; then",
    '  ss -lntH "sport = :80" 2>/dev/null | grep -q . && echo "OTTER_PORT80=in use"',
    '  ss -lntH "sport = :443" 2>/dev/null | grep -q . && echo "OTTER_PORT443=in use"',
    "fi",
    // Feeds the SHARED platform matcher. Same format the migrate detector
    // asks for, so one parser serves both.
    'echo "OTTER_CONTAINERS_BEGIN"',
    "docker ps --no-trunc --format '{{.ID}}\\t{{.Names}}\\t{{.Image}}' 2>/dev/null || true",
    'echo "OTTER_CONTAINERS_END"',
  ].join("\n");
}

export function parseProbe(output: string): ProbeResult {
  const get = (key: string): string => {
    const m = output.match(new RegExp(`^OTTER_${key}=(.*)$`, "m"));
    return m?.[1]?.trim() ?? "";
  };
  const rawPriv = get("PRIV");
  const privilege: Privilege = rawPriv === "root" ? "root" : rawPriv === "sudo" ? "sudo" : "none";
  return {
    osId: get("OS_ID") || "unknown",
    hostname: get("HOSTNAME") || "unknown",
    privilege,
    docker: get("DOCKER") || "none",
    swarmState: get("SWARM") || "unknown",
    edgePortHolders: parsePortHolders(output),
    containerList: sliceBetween(output, "OTTER_CONTAINERS_BEGIN", "OTTER_CONTAINERS_END"),
  };
}

/**
 * Port holders, preferring the named one.
 *
 * The probe can report the same port twice: once from docker (naming the
 * container) and once from `ss` (naming nothing). "coolify-proxy holds :443"
 * is actionable; "in use" is not, so the named answer wins whenever we have
 * one.
 */
function parsePortHolders(output: string): EdgePortHolder[] {
  const holders: EdgePortHolder[] = [];
  for (const port of [80, 443]) {
    const seen = [...output.matchAll(new RegExp(`^OTTER_PORT${port}=(.*)$`, "gm"))]
      .map((m) => m[1]?.trim() ?? "")
      .filter((v) => v.length > 0);
    if (seen.length === 0) continue;
    holders.push({ port, holder: seen.find((v) => v !== "in use") ?? "unknown" });
  }
  return holders;
}

/** The text between two markers, exclusive. Empty when either is missing, so a
 *  truncated stream degrades to "no containers" instead of throwing. */
function sliceBetween(output: string, begin: string, end: string): string {
  const from = output.indexOf(begin);
  const to = output.indexOf(end);
  if (from === -1 || to === -1 || to < from) return "";
  return output.slice(from + begin.length, to).trim();
}
