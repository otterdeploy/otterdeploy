/**
 * od-5j8.9: mint the single-use ticket that authenticates a /pty WebSocket
 * upgrade, and the step-up re-authentication that gates it. The WS upgrade no
 * longer trusts ambient cookies at all; `TerminalSession` calls `getTicket`
 * right before opening (or re-opening, after a drop) each connection.
 */
import { ORPCError } from "@orpc/client";

import { orpc } from "@/shared/server/orpc";

import type { SessionSource } from "../types";

export type ShellTarget = { kind: "container"; containerId: string } | { kind: "host" };

/** Map a terminal session's source to the target the server can mint a
 *  ticket for. `null` for sources with no server-side backend yet (remote
 *  ssh, database consoles): same set `TerminalSession`'s old `buildWsUrl`
 *  already treated as not-implemented. */
export function shellTargetFor(source: SessionSource): ShellTarget | null {
  switch (source.kind) {
    case "container":
      return { kind: "container", containerId: source.containerId };
    case "ssh":
      return source.mode === "local" ? { kind: "host" } : null;
    case "database":
      return null;
  }
}

export class StepUpRequiredError extends Error {
  constructor() {
    super("Re-authenticate to open a shell.");
    this.name = "StepUpRequiredError";
  }
}

/** Mint a ticket for `target`. Throws `StepUpRequiredError` when the caller
 *  needs to complete step-up first (see `submitStepUp` below). The caller
 *  is expected to prompt, call `submitStepUp`, then retry. */
export async function mintShellTicket(target: ShellTarget): Promise<{ ticket: string }> {
  try {
    return await orpc.terminal.mintTicket.call({ target });
  } catch (err) {
    if (err instanceof ORPCError && err.code === "STEP_UP_REQUIRED") {
      throw new StepUpRequiredError();
    }
    throw err;
  }
}

export interface StepUpInput {
  totpCode?: string;
  password?: string;
}

/** Verify a fresh password/TOTP code, granting the short re-auth window
 *  `mintShellTicket` checks. Distinguishes "you didn't send the right field"
 *  from "what you sent was wrong" so the dialog can show a precise message. */
export async function submitStepUp(input: StepUpInput): Promise<void> {
  await orpc.terminal.stepUp.call(input);
}

export function stepUpErrorMessage(err: unknown): string {
  if (err instanceof ORPCError) {
    switch (err.code) {
      case "TWO_FACTOR_CODE_REQUIRED":
        return "Enter the current authenticator code.";
      case "PASSWORD_REQUIRED":
        return "Enter your password.";
      case "INVALID_STEP_UP":
        return "That code or password is incorrect.";
      default:
        break;
    }
  }
  return err instanceof Error ? err.message : "Couldn't verify. Try again.";
}
