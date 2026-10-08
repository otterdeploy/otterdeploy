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
import { createLiveSocketRpcHandler } from "@otterdeploy/api/routers/live-socket-handler";
import { env } from "@otterdeploy/env/server";
import { log, parseError } from "evlog";

import { createLiveSocketHandler } from "./ws";

const rpc = createLiveSocketRpcHandler(appRouter, {
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
      return resolved.isOk() ? resolved.value : null;
    },
    createContext: (c) => createContext({ context: c, broadcast, freshSession: true }),
    rpc,
  });
}
