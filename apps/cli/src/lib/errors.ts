/**
 * One error boundary for every command.
 *
 * Commands throw freely (oRPC errors, zod parse failures, config errors,
 * network failures); `wrapCommand` catches at the top, prints one friendly
 * line (+ hint when we have one), and exits non-zero. Raw stacks only under
 * DEBUG=1. UNAUTHORIZED gets special treatment: when the stale token came
 * from the config file and we're interactive, clear it and re-run the
 * command once — `ensureAuthenticated` inside the command walks the
 * device-code flow again.
 */

import type { CommandDef } from "citty";

import { ORPCError } from "@orpc/client";
import { consola } from "consola";
import * as z from "zod";

import { clearToken, tokenSource } from "../config";

interface FriendlyError {
  message: string;
  hint?: string;
}

function formatOrpcError(error: ORPCError<string, unknown>): FriendlyError {
  switch (error.code) {
    case "UNAUTHORIZED":
      return {
        message: "Not authenticated (or the session expired).",
        hint:
          tokenSource() === "env"
            ? "OTTERDEPLOY_TOKEN was rejected — check the key is valid and not expired."
            : "Run `otterdeploy login <url>` to sign in again.",
      };
    case "NO_ACTIVE_ORGANIZATION":
      return {
        message: "No active organization on this session.",
        hint: "Run `otterdeploy org list` then `otterdeploy org use <slug>`.",
      };
    case "FORBIDDEN":
      return {
        message: `Permission denied: ${error.message}`,
        hint: "Your role or API-key scope doesn't allow this action.",
      };
    case "NOT_FOUND":
      return { message: error.message || "Not found." };
    case "CONFLICT":
      return { message: error.message || "Conflict with existing state." };
    default:
      return { message: `${error.code}: ${error.message}` };
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
  const code = (error as { code?: string }).code;
  if (code && codes.includes(code)) return true;
  if (error.message.includes("Unable to connect") || error.message === "fetch failed") return true;
  return error.cause !== undefined && isNetworkError(error.cause);
}

export function formatCliError(error: unknown): FriendlyError {
  if (error instanceof ORPCError) return formatOrpcError(error);
  if (error instanceof z.ZodError) {
    const issues = error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    return { message: `Config validation failed:\n${issues}` };
  }
  if (isNetworkError(error)) {
    return {
      message: "Could not reach the control plane.",
      hint: "Check the URL (`otterdeploy whoami`) and your network connection.",
    };
  }
  if (error instanceof Error) return { message: error.message };
  return { message: String(error) };
}

function printAndExit(error: unknown): never {
  const { message, hint } = formatCliError(error);
  consola.error(message);
  if (hint) consola.info(hint);
  // oxlint-disable-next-line node/no-process-env, no-console -- CLI env boundary + deliberate DEBUG stack dump
  if (process.env.DEBUG) console.error(error);
  process.exit(1);
}

type RunFn = NonNullable<CommandDef["run"]>;

function withBoundary(run: RunFn): RunFn {
  return async (ctx) => {
    try {
      await run(ctx);
    } catch (error) {
      // Session token from the config file went stale: clear it and retry
      // once — ensureAuthenticated inside the command re-runs the device
      // flow. Env-provided tokens are the caller's to fix; non-TTY can't
      // complete a browser login, so both fall through to the printer.
      const canReauth =
        error instanceof ORPCError &&
        error.code === "UNAUTHORIZED" &&
        tokenSource() === "config" &&
        process.stdin.isTTY;
      if (!canReauth) printAndExit(error);
      consola.warn("Session expired — signing in again.");
      clearToken();
      try {
        await run(ctx);
      } catch (retryError) {
        printAndExit(retryError);
      }
    }
  };
}

/**
 * Recursively wrap a citty command tree so every leaf `run` gets the error
 * boundary. Applied once in index.ts to the root command.
 */
export function wrapCommand(cmd: CommandDef): CommandDef {
  const wrapped: CommandDef = { ...cmd };
  if (typeof cmd.run === "function") wrapped.run = withBoundary(cmd.run as RunFn);
  if (cmd.subCommands && typeof cmd.subCommands === "object") {
    wrapped.subCommands = Object.fromEntries(
      Object.entries(cmd.subCommands).map(([name, sub]) => [
        name,
        typeof sub === "function" ? sub : wrapCommand(sub as CommandDef),
      ]),
    );
  }
  return wrapped;
}
