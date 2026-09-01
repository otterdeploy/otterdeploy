/**
 * The shared vocabulary both PTY backends speak: the `PtyBackend` surface, the
 * start/exit shapes, and the process-environment helpers.
 *
 * Its own module so `host-shell.ts` and `pty.ts` can each depend on it without
 * depending on each other (pty.ts re-exports everything here, so callers still
 * import from one place).
 */

import { Result } from "better-result";
import { log } from "evlog";
import { existsSync } from "node:fs";
import { env as nodeEnv } from "node:process";

import type { PtyExecError, PtySpawnError, PtyTerminalUnavailableError } from "../../lib/errors";

/** Pick an interactive shell that actually exists. $SHELL covers the dev
 *  host (zsh/bash); the production image is oven/bun:alpine, which ships
 *  neither bash nor a $SHELL env: there the POSIX sh fallback is the only
 *  one that spawns, and without it the host terminal dies with
 *  "Executable not found in $PATH: bash" on every connect. */
function resolveShell(): string {
  const fromEnv = nodeEnv.SHELL;
  if (fromEnv && (fromEnv.includes("/") ? existsSync(fromEnv) : Bun.which(fromEnv))) {
    return fromEnv;
  }
  return Bun.which("bash") ?? "/bin/sh";
}

export const SHELL = resolveShell();
export const USR_HOME = nodeEnv.HOME || "/root";

// Minimal shell environment. We deliberately do NOT inherit process.env.
// That would leak server-side secrets (DATABASE_URL, BETTER_AUTH_SECRET, …)
// into the user's shell. Loosen the allowlist if the dev shell needs more.
export function buildBaseEnv(userId: string | undefined): Record<string, string> {
  const childEnv: Record<string, string> = {
    PATH: nodeEnv.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: nodeEnv.HOME ?? "/root",
    USER: nodeEnv.USER ?? "root",
    LOGNAME: nodeEnv.LOGNAME ?? nodeEnv.USER ?? "root",
    SHELL,
    LANG: nodeEnv.LANG ?? "C.UTF-8",
    LC_ALL: nodeEnv.LC_ALL ?? "C.UTF-8",
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
  };
  if (userId) childEnv.OTTERDEPLOY_USER = userId;
  return childEnv;
}

// Run a best-effort side effect and log if it threw. Used for cleanup paths
// where the caller cannot meaningfully recover but we still want a trail.
export function attempt(fn: () => void, event: string): void {
  Result.try(fn).tapError((cause) =>
    log.error({
      pty: { event },
      error: cause instanceof Error ? cause.message : String(cause),
    }),
  );
}

export interface PtyBackend {
  write: (data: string | Uint8Array) => void;
  resize: (cols: number, rows: number) => void;
  dispose: () => void;
}

export interface ExitInfo {
  exitCode: number | null;
  signal: string | null;
}

export interface StartArgs {
  cols: number;
  rows: number;
  userId?: string;
  onData: (chunk: string | Uint8Array) => void;
  onExit: (info: ExitInfo) => void;
}

export type StartError = PtySpawnError | PtyTerminalUnavailableError | PtyExecError;
