/**
 * CLI ↔ control-plane compatibility, decided at CALL time.
 *
 * Releases are lockstepped. One `v*.*.*` tag stamps the CLI and builds the
 * platform images (scripts/update-release-package-versions.ts), but that only
 * makes the two halves comparable, not compatible. The CLI lands on a
 * developer's laptop through npm and is upgraded whenever they feel like it;
 * the control plane sits on an operator's VPS and is upgraded through the
 * in-app updater whenever THEY feel like it. The pair that is actually talking
 * is therefore arbitrary, and before this module neither side ever said so:
 * a CLI five generations ahead just issued calls and got a bare NOT_FOUND for a
 * procedure the server had never heard of.
 *
 * The exchange rides on headers rather than a dedicated endpoint. The verdict
 * comes back on the call the CLI was already making, so it costs no extra round
 * trip, needs no auth (the headers are set before the router runs), and a server
 * older than this code simply sends neither header, which classifies as `ok`
 * and stays silent instead of guessing.
 */

import { parseVersion } from "./compare";

/** Request: the CLI states its version on every RPC call. */
export const CLI_VERSION_HEADER = "x-otterdeploy-cli-version";

/** Response: the control plane's own version (its booted image tag). */
export const SERVER_VERSION_HEADER = "x-otterdeploy-version";

/** Response: the oldest CLI this control plane supports. */
export const MIN_CLI_VERSION_HEADER = "x-otterdeploy-min-cli-version";

/**
 * The oldest CLI generation this control plane will serve without complaint.
 *
 * Bump this ONLY when a contract change genuinely breaks older clients.
 * A removed or renamed procedure, a required input field, a changed output
 * shape a CLI parses. Do NOT bump it just because a release went out: a floor
 * that tracks the current version turns the warning into noise, and a warning
 * users learn to ignore is worse than none.
 *
 * It sits at 0.1.0 because every CLI ever published (0.1.0–0.1.3, then the
 * 0.7.0 lockstep renumber) still speaks a contract this server honours.
 */
export const MIN_CLI_VERSION = "0.1.0";

export type CliCompat =
  | { kind: "ok" }
  /** The CLI predates what this control plane supports. */
  | { kind: "cli-too-old"; cliVersion: string; serverVersion: string | null; minCliVersion: string }
  /** The control plane trails the CLI's generation. Newer commands may be absent. */
  | { kind: "server-behind"; cliVersion: string; serverVersion: string };

export interface CliCompatInput {
  cliVersion: string | null | undefined;
  serverVersion: string | null | undefined;
  minCliVersion: string | null | undefined;
}

/**
 * Classify a CLI/server pair.
 *
 * Anything unparseable yields `ok`. That is the important case, not an edge
 * case: `OTTERDEPLOY_VERSION` defaults to the sentinel `"dev"`, so every
 * development control plane would otherwise nag on every single command.
 * A verdict is only ever issued when both sides name a real release.
 */
export function classifyCliCompat({
  cliVersion,
  serverVersion,
  minCliVersion,
}: CliCompatInput): CliCompat {
  const cli = parseVersion(cliVersion);
  if (!cli) return { kind: "ok" };

  // A CLI below the floor is the actionable case, and the floor alone is enough
  // to decide it: report even when the server's own version is a sentinel.
  const min = parseVersion(minCliVersion);
  if (min && isOlderCore(cli, min)) {
    return {
      kind: "cli-too-old",
      cliVersion: cliVersion as string,
      serverVersion: parseVersion(serverVersion) ? (serverVersion as string) : null,
      minCliVersion: minCliVersion as string,
    };
  }

  const server = parseVersion(serverVersion);
  if (!server) return { kind: "ok" };

  // Compared at MINOR granularity: a patch gap is a bugfix on one side, never a
  // contract change, and flagging it would fire on nearly every pair.
  if (server.major < cli.major || (server.major === cli.major && server.minor < cli.minor)) {
    return {
      kind: "server-behind",
      cliVersion: cliVersion as string,
      serverVersion: serverVersion as string,
    };
  }

  return { kind: "ok" };
}

/** Full `major.minor.patch` ordering: the floor is exact, not minor-rounded. */
function isOlderCore(
  a: NonNullable<ReturnType<typeof parseVersion>>,
  b: NonNullable<ReturnType<typeof parseVersion>>,
): boolean {
  if (a.major !== b.major) return a.major < b.major;
  if (a.minor !== b.minor) return a.minor < b.minor;
  return a.patch < b.patch;
}
