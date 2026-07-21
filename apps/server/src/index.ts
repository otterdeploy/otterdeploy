import type { ContentfulStatusCode } from "hono/utils/http-status";

import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { createAuditPgDrain } from "@otterdeploy/api/audit/pg-drain";
import { createContext } from "@otterdeploy/api/context";
import { appRouter } from "@otterdeploy/api/routers/index";
import { agentHealthIngestHandler } from "@otterdeploy/api/system-health";
import { auth } from "@otterdeploy/auth";
import { env } from "@otterdeploy/env/server";
import { workbenchQueues } from "@otterdeploy/jobs";
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
import { serveStatic, upgradeWebSocket, websocket } from "hono/bun";
import { cors } from "hono/cors";

import { runBootstrap } from "./bootstrap";
import {
  deployAccessHandler,
  deployAuthorizeHandler,
  deployAuthzHandler,
  deployCallbackHandler,
  deployOtpRequestHandler,
  deployOtpVerifyHandler,
  deployPinVerifyHandler,
  deployShareHandler,
  githubInstallCallbackHandler,
  githubManifestCallbackHandler,
  githubWebhookHandler,
  inboundWebhookHandler,
  terminalWebSocketHandler,
  withCanonicalDeviceOrigin,
} from "./handlers";
import { uploadSourceHandler } from "./handlers/upload/source";
import { invalidate } from "./lib/invalidate";

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
    "/api/agent/**", // Health-agent ingest — auth is a Bearer HMAC machine token
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

// Device-code responses get their verification URLs rebased onto the canonical
// control-plane origin on the way out — better-auth can only take a static
// string for that option. See handlers/auth/device-origin.ts.
app.on(["POST", "GET"], "/api/auth/*", async (c) =>
  withCanonicalDeviceOrigin(c.req.path, await auth.handler(c.req.raw)),
);

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

// Liveness + version. `/health` is what the prod compose healthcheck probes;
// `/api/health` (already auth-excluded) is what the browser polls to detect the
// new container after a self-update cutover, then reloads. Reports the running
// image tag so the updater UI can confirm the version actually changed.
app.get("/health", (c) => c.json({ ok: true, version: env.OTTERDEPLOY_VERSION }));
app.get("/api/health", (c) => c.json({ ok: true, version: env.OTTERDEPLOY_VERSION }));

// ─── Workbench: BullMQ dashboard (dev only) ────────────────────────
// The queue-inspection UI (every registry queue, incl. the builder's
// deploy.triggered) ships ONLY in dev: @getworkbench/hono is a devDependency,
// so a production image never installs it — and its heavy transitive deps
// (vite, @cloudflare/workerd, ~150MB) stay out of the image. The dynamic import
// lives behind the NODE_ENV gate so a production bundle never resolves it. It
// can also mutate jobs, so keeping it off in prod is safer. Registered here
// (before the SPA catch-all) so `/jobs` still routes ahead of it in dev.
if (env.NODE_ENV !== "production") {
  const { workbench } = await import("@getworkbench/hono");
  app.route("/jobs", workbench({ queues: workbenchQueues(), title: "otterdeploy jobs" }));
}

// Terminal websocket
// Auth seam left here for when better-auth cookie verification is
// re-enabled (handler reads c.var.userId).
app.get("/pty", terminalWebSocketHandler);

app.post("/api/webhooks/github", githubWebhookHandler);
// Inbound trigger endpoints (Webhooks page). Public by design — auth is the
// per-endpoint HMAC signature + optional IP allowlist, verified in the
// handler; rides the same /api/webhooks/** identify exclusion as GitHub's.
app.post("/api/webhooks/in/:token", inboundWebhookHandler);
app.get("/api/integrations/github/install/callback", githubInstallCallbackHandler);
app.get("/api/integrations/github/manifest/callback", githubManifestCallbackHandler);

// ─── Health-agent ingest ────────────────────────────────────────────
// Per-node health reports from the swarm global agent service (Bearer HMAC
// token, verified in the handler). See docs/designs/server-health-agent.md.
app.post("/api/agent/health", agentHealthIngestHandler);

// ─── Local source upload ───────────────────────────────────────────
// `otterdeploy deploy` streams a source tarball here for a `source: "upload"`
// service; the handler stages it on the shared data dir and enqueues the build
// (Bearer session token or org API key). Raw route — binary body. See
// packages/api/src/routers/project/upload-source.ts.
app.post("/api/services/:resourceId/source", uploadSourceHandler);

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
// Access PIN (NetBird-style shared code) — served on the deployment domain.
app.post("/.well-known/otterdeploy/pin/verify", deployPinVerifyHandler);

// ─── Static web dashboard (production single-image) ────────────────────────
// The published server image bundles the built SPA at ./public and serves it on
// the SAME origin as the API. Registered after every API/rpc/auth route so those
// win; `identify` only gates /api/**, so the shell + assets load unauthenticated
// and the client then calls the authenticated rpc/api. Unknown paths fall back
// to index.html so client-side (TanStack Router) deep links resolve. In dev the
// web app is served by Vite and ./public simply doesn't exist (these no-op).
app.use("/*", serveStatic({ root: "./public" }));
app.get("/*", serveStatic({ path: "index.html", root: "./public" }));

// Live streams (deployment build logs, project events, container/task log
// tails) all run over oRPC event-iterators on /rpc — see packages/api. The
// client retry plugin gives them EventSource-style auto-reconnect, so there
// are no bespoke /sse/* routes to maintain here.

// Startup (migrations → swarm → Caddy reconcile → workers → background
// services) and the SIGTERM/SIGINT drain live in bootstrap.ts.
runBootstrap();

// Dev-only fixed-port listener so the Caddy container can always reach the
// control plane at a stable address for forward_auth + the cross-domain
// auth-handoff callback/share routes. The main server's port is assigned
// dynamically by portless, so host.docker.internal:<that> isn't knowable;
// this binds a deterministic port (DEPLOY_AUTHZ_UPSTREAM points here). In
// production the server is a Swarm service with stable DNS, so
// CONTROL_PLANE_PORT is left unset and this is skipped. Bound once across
// --hot reloads via a global guard (avoids EADDRINUSE).
//
// Guard against binding it on the SAME port the main server (Bun's default
// export) already serves: the docker-compose deployment passes CONTROL_PLANE_PORT
// via env_file AND runs the main server on that same PORT (both 3000), so a
// second listener there would EADDRINUSE against ourselves and crash-loop. Only
// bind when the two ports differ (the dev case: portless gives the main server a
// dynamic port, so the deterministic CONTROL_PLANE_PORT doesn't collide).
const g = globalThis as typeof globalThis & {
  __controlPlaneListener?: { reload: (o: { fetch: typeof app.fetch }) => void };
};
if (env.CONTROL_PLANE_PORT && env.CONTROL_PLANE_PORT !== env.PORT) {
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
