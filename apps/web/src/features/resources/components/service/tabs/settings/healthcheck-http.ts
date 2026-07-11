/**
 * Pure mapping between the health-check card's form values (path + port) and
 * the stored `healthcheck.cmd` array the runtime executes.
 *
 * Docker has no native HTTP probe — the check is a command run INSIDE the
 * container, so we generate a portable shell one-liner that tries wget (BusyBox
 * / Alpine / Debian) and falls back to curl. The `CMD-SHELL` marker is passed
 * through verbatim by the runtime drivers (see `toHealthcheckTest` in
 * packages/api/src/swarm/internals.ts). Images with neither wget nor curl nor
 * `sh` fail the check — the card copy says so instead of pretending.
 *
 * `parseHttpHealthcheckCmd` inverts the template so the card can re-open a
 * stored check into form values; a cmd it can't invert (hand-written via the
 * manifest/API) is surfaced as a custom command rather than silently mangled.
 */

export interface HttpHealthcheck {
  /** Absolute URL path, always with a leading slash. */
  path: string;
  /** Container port the probe hits (loopback inside the container). */
  port: number;
}

// Conservative charset: RFC-3986 path/query characters minus anything that is
// shell-active inside double quotes (`$`, backtick, `"`, `\`) — the path is
// interpolated into a quoted shell string. Also doubles as "stays invertible".
const PATH_RE = /^\/[A-Za-z0-9\-._~!*'();:@&=+,/?%]*$/;

export function isValidHealthcheckPath(path: string): boolean {
  return PATH_RE.test(path);
}

/** Trim + ensure a leading slash; empty input becomes "/". */
export function normalizeHealthcheckPath(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") return "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function probeScript(url: string): string {
  return `wget -q -O /dev/null "${url}" || curl -fsS -o /dev/null "${url}"`;
}

/**
 * Build the stored cmd for an HTTP health check. Throws on an invalid path —
 * callers validate with {@link isValidHealthcheckPath} first; the throw is the
 * backstop that keeps shell-active characters out of the generated script.
 */
export function buildHttpHealthcheckCmd(check: HttpHealthcheck): string[] {
  const path = normalizeHealthcheckPath(check.path);
  if (!isValidHealthcheckPath(path)) {
    throw new Error(`Invalid health check path: ${check.path}`);
  }
  if (!Number.isInteger(check.port) || check.port < 1 || check.port > 65535) {
    throw new Error(`Invalid health check port: ${check.port}`);
  }
  return ["CMD-SHELL", probeScript(`http://127.0.0.1:${check.port}${path}`)];
}

const PROBE_RE =
  /^wget -q -O \/dev\/null "http:\/\/127\.0\.0\.1:(\d{1,5})(\/[^"]*)" \|\| curl -fsS -o \/dev\/null "http:\/\/127\.0\.0\.1:(\d{1,5})(\/[^"]*)"$/;

/**
 * Invert {@link buildHttpHealthcheckCmd}. Returns null for anything that
 * isn't exactly our generated template (custom exec-form commands, edited
 * shell scripts, mismatched wget/curl URLs).
 */
export function parseHttpHealthcheckCmd(cmd: string[] | null | undefined): HttpHealthcheck | null {
  if (!cmd || cmd.length !== 2 || cmd[0] !== "CMD-SHELL") return null;
  const match = PROBE_RE.exec(cmd[1] ?? "");
  if (!match) return null;
  const [, port1, path1, port2, path2] = match;
  if (port1 !== port2 || path1 !== path2) return null;
  const port = Number(port1);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (path1 === undefined || !isValidHealthcheckPath(path1)) return null;
  return { path: path1, port };
}
