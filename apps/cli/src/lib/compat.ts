/**
 * Notice when this CLI and the control plane have drifted apart, and say so
 * once (plainly) at the end of the command.
 *
 * Releases are lockstepped onto one `v*.*.*` tag, but the halves still travel
 * separately: this binary arrives through npm on a laptop, the control plane
 * through the in-app updater on someone's VPS. Nothing keeps them in step, and
 * the failure mode when they diverge is deeply unhelpful. A `NOT_FOUND` on a
 * procedure the server has simply never heard of, indistinguishable from a
 * missing project.
 *
 * The server states its generation on every response it sends
 * (packages/api/src/routers/system/compat.ts); this module just remembers what
 * came back and renders one line. It never issues a request of its own. A
 * version check that costs a round trip on every command would be a worse tax
 * than the problem it solves.
 */

import {
  classifyCliCompat,
  MIN_CLI_VERSION_HEADER,
  SERVER_VERSION_HEADER,
} from "@otterdeploy/api/routers/system/compat";

import { CLI_VERSION } from "../version";
import { hint, hintCmd, warn } from "./ui";

let serverVersion: string | null = null;
let minCliVersion: string | null = null;
let reported = false;

/**
 * Record the compat headers off any control-plane response.
 *
 * Called for every response, so a command that makes ten calls converges on the
 * last one's answer rather than the first, which is what you want mid-update,
 * when the version genuinely changes underneath a running command.
 */
export function observeCompatHeaders(headers: Headers): void {
  serverVersion = headers.get(SERVER_VERSION_HEADER) ?? serverVersion;
  minCliVersion = headers.get(MIN_CLI_VERSION_HEADER) ?? minCliVersion;
}

/** Test seam: the module-level record is per-process state. */
export function resetCompatState(): void {
  serverVersion = null;
  minCliVersion = null;
  reported = false;
}

function suppressed(): boolean {
  // oxlint-disable-next-line node/no-process-env -- CLI env boundary
  const value = process.env.OTTERDEPLOY_NO_VERSION_WARNING;
  return value !== undefined && value !== "" && value !== "0";
}

/**
 * Print the drift warning, at most once per invocation.
 *
 * Goes out through `warn`/`hint`, so it lands on stderr and leaves `--json`
 * stdout pipeable. Silent when the versions agree, when either side is a
 * non-release sentinel (a dev control plane reports `dev`), when the server is
 * too old to send the headers at all, and when the operator has opted out.
 */
export function reportCompatWarning(): void {
  if (reported || suppressed()) return;
  reported = true;

  const verdict = classifyCliCompat({
    cliVersion: CLI_VERSION,
    serverVersion,
    minCliVersion,
  });

  switch (verdict.kind) {
    case "cli-too-old": {
      const against =
        verdict.serverVersion === null
          ? "this control plane"
          : `the control plane (v${verdict.serverVersion})`;
      warn(
        `This CLI is v${verdict.cliVersion}; ${against} needs v${verdict.minCliVersion} or newer.`,
      );
      hint("update with `npm install -g @otterdeploy/cli`");
      break;
    }
    case "server-behind": {
      warn(
        `The control plane is on v${verdict.serverVersion}; this CLI is v${verdict.cliVersion}. Commands added since v${verdict.serverVersion} will not exist there yet.`,
      );
      hintCmd("platform update");
      break;
    }
    case "ok":
      break;
  }
}
