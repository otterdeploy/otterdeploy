/**
 * Dockerfile text helpers shared by the builder (build-context resolution) and
 * the API's repo inspection (the new-service wizard's port default). Pure: no
 * I/O, no zod, so either side can import it.
 */

/**
 * Strip a Dockerfile down to logical instructions: comments removed, line
 * continuations joined. Parser directives (`# syntax=`) are comments too, and
 * carry no instruction, so dropping them is safe.
 */
export function joinInstructions(text: string): string[] {
  const out: string[] = [];
  let pending = "";
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    // A comment inside a continuation is skipped by the Docker parser too,
    // without terminating the continuation.
    if (line.startsWith("#")) continue;
    if (line.endsWith("\\")) {
      pending += `${line.slice(0, -1).trim()} `;
      continue;
    }
    const full = `${pending}${line}`.trim();
    pending = "";
    if (full) out.push(full);
  }
  if (pending.trim()) out.push(pending.trim());
  return out;
}

/** `KEY=value` pairs (and the legacy `ENV KEY value` form) of one ARG/ENV. */
function declaredVars(keyword: string, args: string): Array<[string, string]> {
  const pairs = args.split(/\s+/).filter(Boolean);
  const first = pairs[0];
  if (!first) return [];
  if (keyword === "ENV" && !first.includes("=")) {
    return [[first, pairs.slice(1).join(" ")]];
  }
  const out: Array<[string, string]> = [];
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    out.push([pair.slice(0, eq), pair.slice(eq + 1).replace(/^["']|["']$/g, "")]);
  }
  return out;
}

/** `$NAME`, `${NAME}`, `${NAME:-default}` against what the stage declared. */
function substitute(token: string, vars: ReadonlyMap<string, string>): string {
  return token.replace(
    /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}|([A-Za-z_][A-Za-z0-9_]*))/g,
    (
      _match,
      braced: string | undefined,
      fallback: string | undefined,
      bare: string | undefined,
    ) => {
      const name = braced ?? bare ?? "";
      const value = vars.get(name);
      return value !== undefined && value !== "" ? value : (fallback ?? "");
    },
  );
}

const EXPOSE_TOKEN = /^(\d{1,5})(?:-\d{1,5})?(?:\/(tcp|udp))?$/i;

/**
 * The TCP ports the Dockerfile's FINAL stage declares with `EXPOSE`, in order,
 * de-duplicated. The final stage is what `docker build` produces when no
 * target is set, so an `EXPOSE` in an earlier (build) stage says nothing about
 * where the image listens.
 *
 * Handles `EXPOSE 80`, `EXPOSE 80/tcp 443`, a range (`8000-8010` → its first
 * port) and a variable the stage declared with ARG/ENV (`EXPOSE $PORT`,
 * `${PORT:-8080}`). UDP ports are skipped: the wizard is choosing an HTTP port.
 * Anything it cannot resolve to a number is dropped rather than guessed.
 */
export function dockerfileExposedPorts(text: string): number[] {
  let ports: number[] = [];
  let vars = new Map<string, string>();
  for (const instruction of joinInstructions(text)) {
    const match = /^([A-Za-z]+)\s+(.*)$/.exec(instruction);
    if (!match?.[1] || match[2] === undefined) continue;
    const keyword = match[1].toUpperCase();
    const args = match[2];
    if (keyword === "FROM") {
      ports = [];
      vars = new Map();
    } else if (keyword === "ARG" || keyword === "ENV") {
      for (const [key, value] of declaredVars(keyword, args)) {
        vars.set(key, substitute(value, vars));
      }
    } else if (keyword === "EXPOSE") {
      for (const port of exposedTokens(args, vars)) {
        if (!ports.includes(port)) ports.push(port);
      }
    }
  }
  return ports;
}

/** The TCP ports one `EXPOSE` line names, after variable substitution. */
function exposedTokens(args: string, vars: ReadonlyMap<string, string>): number[] {
  const out: number[] = [];
  for (const raw of args.split(/\s+/)) {
    const token = EXPOSE_TOKEN.exec(substitute(raw, vars));
    if (!token?.[1] || token[2]?.toLowerCase() === "udp") continue;
    const port = Number(token[1]);
    if (port >= 1 && port <= 65535) out.push(port);
  }
  return out;
}
