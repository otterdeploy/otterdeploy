import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler as BunWsRPCHandler } from "@orpc/server/bun-ws";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { createContext } from "@otterstack/api/context";
import { reconcile } from "@otterstack/api/caddy";
import { appRouter } from "@otterstack/api/routers/index";
import { initializeSwarm } from "@otterstack/api/swarm";
import { auth } from "@otterstack/auth";
import { env } from "@otterstack/env/server";
import { initLogger, log, parseError } from "evlog";
import { evlog, type EvlogVariables } from "evlog/hono";
import { Hono } from "hono";
import { upgradeWebSocket, websocket } from "hono/bun";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { invalidate } from "./lib/invalidate";
import { registerTerminalRoutes } from "./terminal";

initLogger({ env: { service: "otterstack-server" } });

const app = new Hono<EvlogVariables>();

app.use(evlog());
app.use(
  "/*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.onError((error, c) => {
  c.get("log").error(error);
  const parsed = parseError(error);
  return c.json(
    { message: parsed.message, why: parsed.why, fix: parsed.fix },
    parsed.status as ContentfulStatusCode,
  );
});

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

const apiHandler = new OpenAPIHandler(appRouter, {
  plugins: [
    new OpenAPIReferencePlugin({
      schemaConverters: [new ZodToJsonSchemaConverter()],
    }),
  ],
  interceptors: [onError((error) => log.error(error as Error))],
});

const rpcHandler = new RPCHandler(appRouter, {
  interceptors: [onError((error) => log.error(error as Error))],
});

const rpcWsHandler = new BunWsRPCHandler(appRouter, {
  interceptors: [onError((error) => log.error(error as Error))],
});

app.use("/*", async (c, next) => {
  const context = await createContext({
    context: c,
    broadcast: invalidate.broadcast,
  });

  const rpcResult = await rpcHandler.handle(c.req.raw, {
    prefix: "/rpc",
    context: context,
  });

  if (rpcResult.matched) {
    return c.newResponse(rpcResult.response.body, rpcResult.response);
  }

  const apiResult = await apiHandler.handle(c.req.raw, {
    prefix: "/api-reference",
    context: context,
  });

  if (apiResult.matched) {
    return c.newResponse(apiResult.response.body, apiResult.response);
  }

  await next();
});

app.get(
  "/ws",
  upgradeWebSocket(() => ({
    onMessage(event, ws) {
      invalidate.onMessage(
        ws,
        typeof event.data === "string" ? event.data : "",
      );
    },
    onClose(_event, ws) {
      invalidate.removeClient(ws);
    },
  })),
);

// oRPC over WebSocket. Same router as the HTTP /rpc handler; choose either
// transport per client. Each WS frame is one RPC message; the bun-ws RPCHandler
// tracks peers by ws identity, so context is built per-message from the upgrade
// request `c`.
app.get(
  "/rpc-ws",
  upgradeWebSocket((c) => ({
    async onMessage(evt, ws) {
      const context = await createContext({
        context: c,
        broadcast: invalidate.broadcast,
      });

      const data = evt.data as string | ArrayBufferView;
      await rpcWsHandler.message(ws.raw, data, {
        context,
      });
    },
    onClose(_evt, ws) {
      rpcWsHandler.close(ws.raw);
    },
  })),
);

app.get("/", (c) => {
  return c.text("OK");
});

registerTerminalRoutes(app);

// Startup tasks: initialize Docker Swarm, then reconcile Caddy from the DB.
async function bootstrap(): Promise<void> {
  try {
    await initializeSwarm();
    log.info({ startup: { step: "swarm", status: "ready" } });
  } catch (error) {
    log.error(error as Error, { startup: { step: "swarm", status: "failed" } });
  }

  try {
    const result = await reconcile();
    log.info({
      startup: {
        step: "caddy-reconcile",
        applied: result.applied.length,
        skipped: result.skipped.length,
        revision: result.revision,
      },
    });
  } catch (error) {
    log.error(error as Error, {
      startup: { step: "caddy-reconcile", status: "failed" },
    });
  }
}

void bootstrap();

export default {
  fetch: app.fetch,
  websocket,
};
