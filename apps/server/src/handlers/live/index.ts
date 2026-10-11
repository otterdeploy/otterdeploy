/**
 * Production wiring for the live socket: the app router, the real session
 * lookup and context. Kept apart from ./ws.ts so the upgrade gate can be
 * tested without importing the whole router.
 */
import type { EvlogVariables } from "evlog/hono";
import type { MiddlewareHandler } from "hono";

import { onError } from "@orpc/server";
import { resolveRequestActor } from "@otterdeploy/api/authz/actor";
import { createContext } from "@otterdeploy/api/context";
import { appRouter } from "@otterdeploy/api/routers/index";
import {
  carryActingOrganization,
  createLiveSocketRpcHandler,
} from "@otterdeploy/api/routers/live-socket-handler";
import { env } from "@otterdeploy/env/server";
import { log, parseError } from "evlog";

import { createLiveSocketHandler } from "./ws";

const rpc = createLiveSocketRpcHandler(appRouter, {
  // The page's organization rides each subscription's message; the session
  // stays the upgrade's.
  withRequestHeaders: carryActingOrganization,
  interceptors: [
    onError((error) => {
      const parsed = parseError(error);
      log.error({
        rpc: { transport: "live-socket", event: "interceptor-error" },
        error: parsed.message,
        code: parsed.code,
      });
    }),
  ],
});

export function liveSocketHandler(
  broadcast: (resource: string) => void,
): MiddlewareHandler<EvlogVariables> {
  return createLiveSocketHandler({
    trustedOrigins: env.CORS_ORIGIN,
    async resolveActor(headers) {
      const resolved = await resolveRequestActor(headers, { freshSession: true });
      if (resolved.isOk()) return resolved.value;
      // The session store did not answer: not a verdict on the caller. The
      // upgrade gate turns a rejection into a 503 and the client stays on HTTP.
      if (resolved.error._tag === "AuthStoreUnavailableError") throw resolved.error;
      return null;
    },
    createContext: (c) => createContext({ context: c, broadcast, freshSession: true }),
    rpc,
  });
}
