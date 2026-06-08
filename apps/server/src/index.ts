import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { createContext } from "@otterdeploy/api/context";
import { reconcile } from "@otterdeploy/api/caddy";
import { appRouter } from "@otterdeploy/api/routers/index";
import { initializeSwarm } from "@otterdeploy/api/swarm";
import { auth } from "@otterdeploy/auth";
import { env } from "@otterdeploy/env/server";
import {
  createWorkers,
  jobs as allJobs,
  workbenchQueues,
} from "@otterdeploy/jobs";
import { workbench } from "@getworkbench/hono";
import { Result } from "better-result";
import {
  auditEnricher,
  auditOnly,
  drainPlugin,
  enricherPlugin,
  initLogger,
  log,
  parseError,
} from "evlog";
import { createAuditPgDrain } from "@otterdeploy/api/audit/pg-drain";
import { evlog, type EvlogVariables } from "evlog/hono";
import { BootstrapError } from "./lib/errors";
import { Hono } from "hono";
import { upgradeWebSocket, websocket } from "hono/bun";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { invalidate } from "./lib/invalidate";

import * as z from "zod";
import { ID_PREFIX, zId } from "@otterdeploy/shared/id";
import {
  deploymentLogsSseHandler,
  githubInstallCallbackHandler,
  githubManifestCallbackHandler,
  githubWebhookHandler,
  projectEventsSseHandler,
  terminalWebSocketHandler,
} from "./handlers";
import { requireSseSession } from "./lib/sse-auth";
import { validateParams } from "./lib/validate";

import { createAuthMiddleware } from "evlog/better-auth";

initLogger({
  env: { service: "otterdeploy-server" },
  plugins: [
    // Auto-fill audit.context (requestId / traceId / ip / userAgent) on every
    // request-scoped audit event.
    enricherPlugin("audit-context", auditEnricher()),
    // Persist audit events to Postgres. `auditOnly` filters to events with
    // `event.audit` set; `await` makes the write crash-safe. Runs alongside
    // the default console drain — normal logging is untouched.
    drainPlugin("audit-pg", auditOnly(createAuditPgDrain(), { await: true })),
  ],
});

const app = new Hono<EvlogVariables>();

const identify = createAuthMiddleware(auth, {
  exclude: [
    "/api/auth/**", // Better Auth itself
    "/api/public/**", // Public endpoints
    "/api/health", // Health checks
    "/api/webhooks/**", // Inbound webhooks — auth is per-source signature
    "/api/integrations/github/**", // GitHub App install callback — uses signed state
  ],
  include: ["/api/**"],
  maskEmail: true,
});

app.use(
  evlog({
    include: ["/api/**", "/rpc/**", "/jobs/**", "/**"],
    exclude: ["/api/health"],
  }),
);

// Streaming-tolerant logger wrapper. For event-iterator procedures the
// response body keeps producing after evlog's `finish()` has already
// emitted the wide event — any `log.set()` from the generator body races
// against that flush and gets dropped with a console warning. We silence
// the noise by intercepting `emit` to flip a local flag, then making
// post-emit `set` a silent no-op. Pre-emit `set` still works normally;
// only the "you're too late" case is suppressed. Per-stream observability
// should go through `log.info(...)` on the global logger anyway, which
// bypasses the request wide event entirely.
app.use(async (c, next) => {
  const logger = c.get("log");
  if (logger?.emit && logger.set) {
    let emitted = false;
    const originalEmit = logger.emit.bind(logger);
    const originalSet = logger.set.bind(logger);
    logger.emit = (...args: Parameters<typeof originalEmit>) => {
      emitted = true;
      return originalEmit(...args);
    };
    logger.set = (data: Record<string, unknown>) => {
      if (emitted) return;
      originalSet(data);
    };
  }
  await next();
});

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
    broadcast: (resource) => invalidate.broadcast(resource),
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

// ─── Workbench: BullMQ dashboard ───────────────────────────────────
// Shows every registry queue, including the builder's deploy.triggered
// (consumed in apps/builder — same Redis keys). Mounted only when
// WORKBENCH_USER/PASS are set; basic-auth gated since it can mutate jobs.
// if (env.WORKBENCH_USER && env.WORKBENCH_PASS) {
app.route(
  "/jobs",
  workbench({
    queues: workbenchQueues(),
    title: "otterdeploy jobs",
    // auth: { username: env.WORKBENCH_USER, password: env.WORKBENCH_PASS },
  }),
);
// }

// ─── Terminal websocket ────────────────────────────────────────────
// Auth seam left here for when better-auth cookie verification is
// re-enabled (handler reads c.var.userId).
app.get("/pty", terminalWebSocketHandler);

// ─── GitHub webhooks + install callbacks ───────────────────────────
app.post("/api/webhooks/github", githubWebhookHandler);
app.get(
  "/api/integrations/github/install/callback",
  githubInstallCallbackHandler,
);
app.get(
  "/api/integrations/github/manifest/callback",
  githubManifestCallbackHandler,
);

// ─── SSE ───────────────────────────────────────────────────────────
// Cookie auth + zod-validated path params via middleware; handler
// files in ./handlers stay focused on the streaming protocol.
app.get(
  "/sse/deployments/:deploymentId/logs",
  validateParams(z.object({ deploymentId: zId(ID_PREFIX.deployment) })),
  requireSseSession,
  deploymentLogsSseHandler,
);
app.get(
  "/sse/projects/:projectId/events",
  validateParams(z.object({ projectId: zId(ID_PREFIX.project) })),
  requireSseSession,
  projectEventsSseHandler,
);

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
    // The deploy.triggered worker runs in apps/builder (it needs the
    // railpack + docker binaries). The API still enqueues jobs onto that
    // queue from the git-webhook receiver — only the consumer moves.
    try: () =>
      createWorkers({
        jobs: allJobs.filter((j) => j.name !== "deploy.triggered"),
      }),
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
};
