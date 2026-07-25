import { ORPCError } from "@orpc/server";

import type { Context } from "../context";

const DENIED_ORPC_CODES = new Set(["UNAUTHORIZED", "FORBIDDEN", "NO_ACTIVE_ORGANIZATION"]);

export function traceActor(context: Context) {
  const user = context.session?.user;
  return user
    ? { type: "user" as const, id: user.id, email: user.email }
    : { type: "api" as const, id: context.apiKey?.id ?? "anonymous" };
}

export function classifyTraceError(error: unknown) {
  const isOrpc = error instanceof ORPCError;
  const code = isOrpc ? error.code : undefined;
  const reason = error instanceof Error ? error.message : String(error);
  const denied = Boolean(code && DENIED_ORPC_CODES.has(code));
  const detail = isOrpc
    ? { name: error.name, message: error.message, code: error.code }
    : error instanceof Error
      ? { name: error.name, message: error.message }
      : error;
  return { reason, denied, detail };
}
