/**
 * One error boundary for every command.
 *
 * Commands throw freely (oRPC errors, zod parse failures, config errors,
 * network failures); `wrapCommand` catches at the top, prints one friendly
 * line plus whatever recovery steps we know, and exits non-zero. Raw stacks only
 * under DEBUG=1. UNAUTHORIZED gets special treatment: when the stale token came
 * from the config file and we're interactive, clear it and re-run the command
 * once: `ensureAuthenticated` inside the command walks the device-code flow
 * again.
 *
 * Every hint is built with `cmd()` so it names the bin the user actually typed.
 * A hint that says `otterdeploy login` to someone who typed `otd` is a hint they
 * have to translate before they can use it.
 */

import type { CommandDef } from "citty";

import { ORPCError } from "@orpc/client";
import * as z from "zod";

import { clearToken, tokenSource } from "../config";
import { reportCompatWarning } from "./compat";
import { cmd } from "./name";
import { abort, dim, err, line, warn } from "./ui";

interface FriendlyError {
  message: string;
  /** Recovery steps, rendered as `→` lines under the failure. */
  hints: string[];
  /** Supporting facts (e.g. per-field validation issues), rendered plainly. */
  details?: string[];
}

function formatOrpcError(error: ORPCError<string, unknown>): FriendlyError {
  switch (error.code) {
    case "UNAUTHORIZED":
      return {
        message: "Not authenticated, or the session expired.",
        hints:
          tokenSource() === "env"
            ? ["OTTERDEPLOY_TOKEN was rejected. Check the key is valid and not expired"]
            : [`run \`${cmd("login <url>")}\` to sign in again`],
      };
    case "NO_ACTIVE_ORGANIZATION":
      return {
        message: "No active organization on this session.",
        hints: [`run \`${cmd("org list")}\` to see them`, `then \`${cmd("org use <slug>")}\``],
      };
    case "FORBIDDEN":
      return {
        message: `Permission denied: ${error.message}`,
        hints: ["your role or API-key scope doesn't allow this action"],
      };
    case "NOT_FOUND":
      return { message: error.message || "Not found.", hints: [] };
    case "CONFLICT":
      return { message: error.message || "Conflict with existing state.", hints: [] };
    default:
      return { message: `${error.code}: ${error.message}`, hints: [] };
  }
}

/** True for Bun/undici-style transport failures (server unreachable). */
function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const codes = [
    "ConnectionRefused",
    "ECONNREFUSED",
    "ENOTFOUND",
    "ConnectionClosed",
    "FailedToOpenSocket",
  ];
  const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
  if (code && codes.includes(code)) return true;
  if (error.message.includes("Unable to connect") || error.message === "fetch failed") return true;
  return error.cause !== undefined && isNetworkError(error.cause);
}

export function formatCliError(error: unknown): FriendlyError {
  if (error instanceof ORPCError) return formatOrpcError(error);
  if (error instanceof z.ZodError) {
    return {
      message: "Config validation failed.",
      // One line per bad field, so a config with four mistakes reports four
      // fixes instead of only the first the parser tripped on.
      details: error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
      hints: [],
    };
  }
  if (isNetworkError(error)) {
    return {
      message: "Could not reach the control plane.",
      hints: [`check the URL with \`${cmd("whoami")}\``, "then check your network connection"],
    };
  }
  if (error instanceof Error) return { message: error.message, hints: [] };
  return { message: String(error), hints: [] };
}

function printAndExit(error: unknown): never {
  // Before the failure, not after: a CLI/server version gap is frequently the
  // CAUSE of the error below (a procedure the old server never had reads as a
  // bare NOT_FOUND), so it belongs as context above it, and `abort` exits the
  // process, so anything printed afterwards would never run.
  reportCompatWarning();

  const { message, hints, details } = formatCliError(error);
  // Details precede the hints: facts first, then what to do about them. They go
  // to stderr with the failure so `--json` stdout stays clean.
  if (details?.length) {
    err();
    for (const d of details) line(dim(d));
    err();
  }
  // oxlint-disable-next-line node/no-process-env, no-console -- CLI env boundary + deliberate DEBUG stack dump
  if (process.env.DEBUG) console.error(error);
  abort(message, ...hints);
}

type RunFn = NonNullable<CommandDef["run"]>;

function withBoundary(run: RunFn): RunFn {
  return async (ctx) => {
    try {
      await run(ctx);
    } catch (error) {
      // Session token from the config file went stale: clear it and retry
      // once, ensureAuthenticated inside the command re-runs the device
      // flow. Env-provided tokens are the caller's to fix; non-TTY can't
      // complete a browser login, so both fall through to the printer.
      const canReauth =
        error instanceof ORPCError &&
        error.code === "UNAUTHORIZED" &&
        tokenSource() === "config" &&
        process.stdin.isTTY;
      if (!canReauth) printAndExit(error);
      warn("Session expired. Signing in again.");
      clearToken();
      try {
        await run(ctx);
      } catch (retryError) {
        printAndExit(retryError);
      }
    }
    // Trailing the command's own output, where a non-fatal note belongs. Idempotent,
    // so the failure path above having already spoken keeps this one silent.
    reportCompatWarning();
  };
}

/**
 * Recursively wrap a citty command tree so every leaf `run` gets the error
 * boundary. Applied once in index.ts to the root command.
 */
export function wrapCommand(cmd_: CommandDef): CommandDef {
  const wrapped: CommandDef = { ...cmd_ };
  if (typeof cmd_.run === "function") wrapped.run = withBoundary(cmd_.run);
  // A `Resolvable` subCommands map can also be a Promise / factory; only a
  // plain object of definitions can be walked and wrapped here. Lazy entries
  // (functions) pass through unwrapped, exactly as before.
  if (
    cmd_.subCommands &&
    typeof cmd_.subCommands === "object" &&
    !(cmd_.subCommands instanceof Promise)
  ) {
    wrapped.subCommands = Object.fromEntries(
      Object.entries(cmd_.subCommands).map(([name, sub]) => [
        name,
        typeof sub === "function" || sub instanceof Promise ? sub : wrapCommand(sub),
      ]),
    );
  }
  return wrapped;
}
