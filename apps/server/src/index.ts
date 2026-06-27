import type { ContentfulStatusCode } from "hono/utils/http-status";

import { workbench } from "@getworkbench/hono";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { createAuditPgDrain } from "@otterdeploy/api/audit/pg-drain";
import { startBackupScheduler } from "@otterdeploy/api/backups";
import { reconcile } from "@otterdeploy/api/caddy";
import { createContext } from "@otterdeploy/api/context";
import { startEdgeLogPersistence, startEdgeLogSink } from "@otterdeploy/api/edge-logs";
import { startDataFolderSweep } from "@otterdeploy/api/lib/data-folder-sweep";
import { ensureServerIp } from "@otterdeploy/api/lib/server-ip";
import { startMetricsSampler } from "@otterdeploy/api/metrics";
import { startAuditAnomalyScan } from "@otterdeploy/api/notifications/audit-anomaly";
import { startBlocklistScheduler } from "@otterdeploy/api/routers/firewall/scheduler";
import { appRouter } from "@otterdeploy/api/routers/index";
import { initializeSwarm } from "@otterdeploy/api/swarm";
import { auth } from "@otterdeploy/auth";
import { env } from "@otterdeploy/env/server";
import { createWorkers, jobs as allJobs, workbenchQueues } from "@otterdeploy/jobs";
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
import { createAuthMiddleware } from "evlog/better-auth";
import { evlog, type EvlogVariables } from "evlog/hono";
import { Hono } from "hono";
import { upgradeWebSocket, websocket } from "hono/bun";
import { cors } from "hono/cors";

import {
  deployAccessHandler,
  deployAuthorizeHandler,
  deployAuthzHandler,
  deployCallbackHandler,
  deployOtpRequestHandler,
  deployOtpVerifyHandler,
  deployShareHandler,
  githubInstallCallbackHandler,
  githubManifestCallbackHandler,
  githubWebhookHandler,
  terminalWebSocketHandler,
} from "./handlers";
import { BootstrapError } from "./lib/errors";
import { invalidate } from "./lib/invalidate";
import { isTracingConfigured, shutdownTracing, startTracing } from "./lib/tracing";

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
    prefix: "/api/reference",
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
      invalidate.onMessage(ws, typeof event.data === "string" ? event.data : "");
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

// Terminal websocket
// Auth seam left here for when better-auth cookie verification is
// re-enabled (handler reads c.var.userId).
app.get("/pty", terminalWebSocketHandler);

app.post("/api/webhooks/github", githubWebhookHandler);
app.get("/api/integrations/github/install/callback", githubInstallCallbackHandler);
app.get("/api/integrations/github/manifest/callback", githubManifestCallbackHandler);

// ─── Deployment protection (auth wall) ─────────────────────────────
// forward_auth target (internal subrequest from Caddy) + the cross-domain
// handoff endpoints. /api/internal/deploy-authz gates each request; the
// /.well-known/otterdeploy/* routes run the authority→callback handoff and
// shareable-link exchange. See docs/designs/deployment-protection.md.
app.get("/api/internal/deploy-authz", deployAuthzHandler);
app.get("/.well-known/otterdeploy/authorize", deployAuthorizeHandler);
app.get("/.well-known/otterdeploy/callback", deployCallbackHandler);
app.get("/.well-known/otterdeploy/share", deployShareHandler);
// Guest access (email one-time PIN) — served on the deployment domain.
app.get("/.well-known/otterdeploy/access", deployAccessHandler);
app.post("/.well-known/otterdeploy/otp/request", deployOtpRequestHandler);
app.post("/.well-known/otterdeploy/otp/verify", deployOtpVerifyHandler);

// Live streams (deployment build logs, project events, container/task log
// tails) all run over oRPC event-iterators on /rpc — see packages/api. The
// client retry plugin gives them EventSource-style auto-reconnect, so there
// are no bespoke /sse/* routes to maintain here.

// Startup tasks: initialize Docker Swarm, then reconcile Caddy from the DB,
// then boot BullMQ workers (in-process). The worker stop handle is captured
// so SIGTERM can drain in-flight jobs before the process exits.
let stopWorkers: (() => Promise<void>) | null = null;
let stopBackupScheduler: (() => void) | null = null;
let stopMetricsSampler: (() => void) | null = null;
let stopBlocklistScheduler: (() => void) | null = null;
let stopDataFolderSweep: (() => void) | null = null;
let stopAuditAnomalyScan: (() => void) | null = null;
let stopTracing: (() => Promise<void>) | null = null;

async function bootstrap() {
  // OpenTelemetry — opt-in, started first so auto-instrumentation patches as
  // much as possible. Dormant unless an OTLP collector is configured (else the
  // exporters would spam connection-refused against a default localhost:4318).
  if (isTracingConfigured()) {
    startTracing();
    stopTracing = shutdownTracing;
    log.info({ startup: { step: "otel-tracing", status: "ready" } });
  }

  // Edge-log sink: bind the TCP listener Caddy streams logs to — both per-site
  // access logs and the global default logger's operational events (Phase 3).
  // Only when EDGE_LOG_SINK is configured (otherwise the Caddyfile carries
  // no `output net`, so nothing would connect anyway).
  if (env.EDGE_LOG_SINK) {
    Result.try({
      try: () => {
        startEdgeLogSink(env.EDGE_LOG_PORT);
        // Persist behind the live ring unless explicitly disabled, so the
        // 24h/7d ranges and percentiles work and survive restarts.
        if (env.EDGE_LOG_PERSIST) startEdgeLogPersistence();
      },
      catch: (cause) => new BootstrapError({ step: "edge-log-sink", cause }),
    }).match({
      ok: () =>
        log.info({
          startup: {
            step: "edge-log-sink",
            port: env.EDGE_LOG_PORT,
            persist: env.EDGE_LOG_PERSIST,
          },
        }),
      err: (err) =>
        log.error({
          startup: { step: "edge-log-sink", status: "failed" },
          error: err.message,
        }),
    });
  }

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

  // Resolve the public IP for sslip.io fallback domains before reconcile,
  // so a fresh install publishes a reachable hostname instead of loopback.
  // Override via SERVER_IP; auto-detected in production; skipped in dev.
  const serverIp = await Result.tryPromise({
    try: () =>
      ensureServerIp({
        override: env.SERVER_IP ?? null,
        allowDetect: env.NODE_ENV !== "development",
      }),
    catch: (cause) => new BootstrapError({ step: "server-ip", cause }),
  });
  serverIp.match({
    ok: (result) =>
      log.info({
        startup: { step: "server-ip", source: result.source, ip: result.ip },
      }),
    err: (err) =>
      log.error({
        startup: { step: "server-ip", status: "failed" },
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

  // Backup schedule scanner — scans backup_schedule rows every minute and
  // runs due backups + retention (docs/designs/backups.md). DB is the source
  // of truth so cron/retention edits take effect immediately.
  stopBackupScheduler = startBackupScheduler();
  log.info({ startup: { step: "backup-scheduler", status: "ready" } });

  // Metrics sampler — records CPU/memory/network for managed containers into
  // resource_metric every 30s (feeds the service-node metrics charts).
  stopMetricsSampler = startMetricsSampler();
  log.info({ startup: { step: "metrics-sampler", status: "ready" } });

  // Managed blocklists — re-import enabled public/custom lists into CrowdSec on
  // their interval so the imported decisions refresh before they expire.
  stopBlocklistScheduler = startBlocklistScheduler();
  log.info({ startup: { step: "blocklist-scheduler", status: "ready" } });

  // Data-folder orphan sweep — reclaims artifact dirs (resources/projects/
  // backups) whose owning DB row is gone, e.g. after a crashed teardown
  // (docs/designs/data-folder.md, Phase 5). No-op when /data isn't in use.
  stopDataFolderSweep = startDataFolderSweep();
  log.info({ startup: { step: "data-folder-sweep", status: "ready" } });

  // Audit-anomaly scan — periodic, conservative rules over recent audit rows
  // (denial bursts, mass deletions) that emit `audit.anomaly` notifications.
  stopAuditAnomalyScan = startAuditAnomalyScan();
  log.info({ startup: { step: "audit-anomaly-scan", status: "ready" } });
}

void bootstrap();

// Drain workers on SIGTERM / SIGINT so in-flight jobs finish before exit.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, async () => {
    log.info({ shutdown: { signal, step: "draining-workers" } });
    if (stopBackupScheduler) stopBackupScheduler();
    if (stopMetricsSampler) stopMetricsSampler();
    if (stopBlocklistScheduler) stopBlocklistScheduler();
    if (stopDataFolderSweep) stopDataFolderSweep();
    if (stopAuditAnomalyScan) stopAuditAnomalyScan();
    if (stopTracing) await stopTracing().catch(() => undefined);
    if (stopWorkers) await stopWorkers().catch(() => undefined);
    process.exit(0);
  });
}

// Dev-only fixed-port listener so the Caddy container can always reach the
// control plane at a stable address for forward_auth + the cross-domain
// auth-handoff callback/share routes. The main server's port is assigned
// dynamically by portless, so host.docker.internal:<that> isn't knowable;
// this binds a deterministic port (DEPLOY_AUTHZ_UPSTREAM points here). In
// production the server is a Swarm service with stable DNS, so
// CONTROL_PLANE_PORT is left unset and this is skipped. Bound once across
// --hot reloads via a global guard (avoids EADDRINUSE).
const g = globalThis as typeof globalThis & {
  __controlPlaneListener?: { reload: (o: { fetch: typeof app.fetch }) => void };
};
if (env.CONTROL_PLANE_PORT) {
  if (g.__controlPlaneListener) {
    // --hot reloaded: swap the handler in place so the auth routes pick up
    // edits without a rebind (avoids both EADDRINUSE and stale code).
    g.__controlPlaneListener.reload({ fetch: app.fetch });
  } else {
    g.__controlPlaneListener = Bun.serve({
      port: env.CONTROL_PLANE_PORT,
      hostname: "0.0.0.0",
      fetch: app.fetch,
    });
    log.info({
      startup: { step: "control-plane-listener", port: env.CONTROL_PLANE_PORT },
    });
  }
}

export default {
  fetch: app.fetch,
  websocket,
};
