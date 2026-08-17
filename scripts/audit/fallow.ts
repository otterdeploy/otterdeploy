/**
 * One place that knows how to run fallow.
 *
 * The version is pinned. A ratchet compares today's numbers against a committed
 * baseline, so the analyser producing both has to be the same one. An unpinned
 * `bunx fallow` silently upgrades mid-sweep and every count moves for reasons
 * that have nothing to do with the code. Bumping this line is a deliberate act:
 * re-run `bun scripts/audit/ratchet.ts --update` in the same commit so the
 * baseline and the analyser move together.
 */

import { execFileSync } from "node:child_process";

export const FALLOW_VERSION = "3.10.0";

/**
 * Run one fallow analysis and parse its JSON, or null if it could not run.
 *
 * Callers decide what a null means. `evidence` degrades to a thinner worklist;
 * `ratchet` treats it as a hard failure, because a gate that passes when its
 * analyser is missing is not a gate.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function fallowJson(args: string[], cwd: string): Record<string, unknown> | null {
  const read = (raw: string): Record<string, unknown> | null => {
    try {
      const parsed: unknown = JSON.parse(raw);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };
  const argv = [`fallow@${FALLOW_VERSION}`, ...args, "--format", "json", "--quiet"];
  try {
    return read(
      execFileSync("bunx", argv, {
        cwd,
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
  } catch (err) {
    // fallow exits non-zero whenever it finds issues, which is the normal case.
    // Its stdout is still the report we want. Only an unparseable stdout means
    // the run itself failed.
    const stdout =
      typeof err === "object" && err !== null && "stdout" in err && typeof err.stdout === "string"
        ? err.stdout
        : null;
    return stdout ? read(stdout) : null;
  }
}
