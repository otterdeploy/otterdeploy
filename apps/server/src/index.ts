import type { ContentfulStatusCode } from "hono/utils/http-status";

import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { createAuditPgDrain } from "@otterdeploy/api/audit/pg-drain";
import { createContext } from "@otterdeploy/api/context";
import { appRouter } from "@otterdeploy/api/routers/index";
import {
  MIN_CLI_VERSION,
  MIN_CLI_VERSION_HEADER,
  SERVER_VERSION_HEADER,
} from "@otterdeploy/api/routers/system/compat";
import { bodyLimitMiddleware } from "@otterdeploy/api/security/body-limit";
import { sanitizeForwardingHeaders } from "@otterdeploy/api/security/trusted-proxy";
import { agentHealthIngestHandler, checkReadiness } from "@otterdeploy/api/system-health";
import { auth, getRegistrationMode } from "@otterdeploy/auth";
import { guardSignInMethod, publicAuthConfig } from "@otterdeploy/auth/public-config";
import { BOOTSTRAP_TOKEN_HEADER } from "@otterdeploy/auth/registration-policy";
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
import { completeNodeEnrollmentHandler, redeemNodeEnrollmentHandler } from "./handlers/enrollment";
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
    // the default console drain: normal logging is untouched.
    drainPlugin("audit-pg", auditOnly(createAuditPgDrain(), { await: true })),
  ],
});

const app = new Hono<EvlogVariables>();

// Cache policy, set HERE rather than left to the edge or the browser's
// heuristics. Vite content-hashes every asset filename, so those are immutable
// and can be cached for a year, but `index.html` is the mutable pointer AT
// them, and it shipped with no cache directives at all. A browser then applies
// heuristic caching to it, keeps the old index, and the old index keeps naming
// the old hashed bundle (itself cached). The result: an operator ran the
// PREVIOUS build for hours after a deploy, saw a fixed bug still reproducing,
// and had no way to tell the difference from the fix not working.
app.use("/*", async (c, next) => {
  await next();
  if (c.req.method !== "GET" || c.res.status !== 200) return;
  // Mutate the response's own headers rather than calling `c.header()`: by the
  // time this runs, serveStatic has already produced the Response, and
  // `c.header()` only feeds headers into a response Hono has yet to build. The
  // difference is silent. It set the asset header (served by the first
  // handler) and dropped it on index.html (served by the deep-link fallback),
  // which is the one that actually needed it.
  const set = (v: string) => {
    try {
      c.res.headers.set("Cache-Control", v);
    } catch {
      // An immutable Headers (some upstream Responses), nothing to do, and a
      // cache hint is never worth failing a request over.
    }
  };
  // Content-hashed build output. The name changes when the bytes do.
  if (c.req.path.startsWith("/assets/")) {
    set("public, max-age=31536000, immutable");
    return;
  }
  // Everything else the SPA serves is a mutable entry point (index.html and
  // the deep-link fallback below). `no-cache` still allows a 304. It means
  // "revalidate", not "never store".
  if (!c.res.headers.get("Cache-Control")) set("no-cache");
});

// od-5j8.10, trusted-proxy + body-limit gates. Both run FIRST, ahead of
// every other middleware (including evlog): sanitizing X-Forwarded-*
// against the trusted-proxy list before evlog's auditEnricher reads
// x-forwarded-for straight off the headers is what keeps a spoofed IP out of
// the audit trail (evlog has no injectable IP resolver, see
// packages/api/src/security/trusted-proxy.ts), and rejecting an oversized
// body before any handler/logger touches it is what makes the 413 early
// rather than post-buffer. Shared with the terminal-WS/ticket work
// (od-5j8.9) landing in this same file: kept to these two focused
// `app.use` calls so the two changes don't collide.
app.use(async (c, next) => {
  sanitizeForwardingHeaders(c);
  await next();
});
app.use(bodyLimitMiddleware());

const identify = createAuthMiddleware(auth, {
  exclude: [
    "/api/auth/**", // Better Auth itself
    "/api/public/**", // Public endpoints
    "/api/health", // Health checks
    "/api/webhooks/**", // Inbound webhooks: auth is per-source signature
    "/api/integrations/github/**", // GitHub App install callback: uses signed state
    "/api/agent/**", // Health-agent ingest: auth is a Bearer HMAC machine token
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
// emitted the wide event. Any `log.set()` from the generator body races
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
    logger.set = (data: Parameters<typeof originalSet>[0]) => {
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
    // The bootstrap header MUST be listed: the web app and the API are separate
    // origins (3001 vs 3000 in dev, and any split-origin deploy), so sign-up
    // sends `x-otterdeploy-bootstrap-token` as a CORS-unsafe request header. Left
    // out, the browser fails the preflight and the first-account form can never
    // reach the server, the one flow with no alternative path in.
    allowHeaders: ["Content-Type", "Authorization", BOOTSTRAP_TOKEN_HEADER],
    credentials: true,
  }),
);

// Every status hono's `ContentfulStatusCode` names (except the type-only -1
// "unofficial" marker). Each literal is checked against the union, so a hono
// upgrade that changes the set fails compilation here instead of drifting.
const CONTENTFUL_STATUS_CODES: ReadonlySet<ContentfulStatusCode> = new Set([
  100, 102, 103, 200, 201, 202, 203, 206, 207, 208, 226, 300, 301, 302, 303, 305, 306, 307, 308,
  400, 401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 412, 413, 414, 415, 416, 417, 418,
  421, 422, 423, 424, 425, 426, 428, 429, 431, 451, 500, 501, 502, 503, 504, 505, 506, 507, 508,
  510, 511,
]);

function isContentfulStatusCode(status: number): status is ContentfulStatusCode {
  const codes: ReadonlySet<number> = CONTENTFUL_STATUS_CODES;
  return codes.has(status);
}

app.onError((error, c) => {
  c.get("log").error(error);
  const parsed = parseError(error);
  return c.json(
    { message: parsed.message, why: parsed.why, fix: parsed.fix },
    // parseError types `status` as a bare number; a non-standard or bodyless
    // status can't carry this JSON error body, so those collapse to 500.
    isContentfulStatusCode(parsed.status) ? parsed.status : 500,
  );
});

// Public but deliberately low-information: everything the unauthenticated
// sign-in page needs to render itself correctly, and nothing more.
//
//   mode: bootstrap form / open sign-up / invitation-only.
//   socialProviders: the ids actually registered on the live auth instance.
//   signIn: which of password / passkey / enterprise-SSO the operator allows.
//   ssoProviders: one "Continue with <IdP>" button each.
//
// All of it has to be served at RUNTIME rather than baked into the bundle (the
// old VITE_AUTH_SOCIAL_PROVIDERS): a self-hoster runs a prebuilt image, so a
// build-time value meant they could never turn SSO on without rebuilding the
// SPA. Reporting only what is LIVE also means the page cannot render a button
// that dead-ends on an unconfigured provider or a disabled method.
//
// This shapes the page; it does not enforce anything. The gate below is what
// enforces it. See packages/auth/src/public-config.ts, which owns both.
app.get("/api/auth/public-config", async (c) => {
  c.header("Cache-Control", "no-store");
  return c.json(await publicAuthConfig());
});

// Superseded by /api/auth/public-config; kept so an SPA build cached by a
// browser across an upgrade keeps resolving its registration mode.
app.get("/api/auth/bootstrap-status", async (c) => {
  c.header("Cache-Control", "no-store");
  return c.json({ mode: await getRegistrationMode() });
});

// Every auth request passes the sign-in-method gate before better-auth sees
// it. This is the enforcement point for the operator's "which sign-in methods
// does this installation accept" setting: hiding a button on the sign-in page
// is presentation, and presentation must never be load-bearing. The gate costs
// nothing on non-sign-in paths (`/get-session`, the polled device-token loop):
// it matches the path first and only then reads the setting.
//
// Device-code responses get their verification URLs rebased onto the canonical
// control-plane origin on the way out: better-auth can only take a static
// string for that option. See handlers/auth/device-origin.ts.
app.on(["POST", "GET"], "/api/auth/*", async (c) => {
  const refused = await guardSignInMethod(c.req.path);
  if (refused) return refused;
  return withCanonicalDeviceOrigin(c.req.path, await auth.handler(c.req.raw));
});

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

/**
 * Announce this control plane's generation, and the oldest CLI it supports, on
 * every RPC and OpenAPI response.
 *
 * The CLI reads these off the call it was already making and warns the user
 * when the pair has drifted apart. See packages/api/src/routers/system/compat.ts
 * for why release-time lockstep does not make that check redundant. Set on the
 * response rather than served from an endpoint so it costs no round trip and
 * needs no auth; browsers ignore it, and a CLI talking to an older server sees
 * neither header and stays quiet.
 */
function withCompatHeaders(response: Response): Response {
  response.headers.set(SERVER_VERSION_HEADER, env.OTTERDEPLOY_VERSION);
  response.headers.set(MIN_CLI_VERSION_HEADER, MIN_CLI_VERSION);
  return response;
}

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
    return withCompatHeaders(c.newResponse(rpcResult.response.body, rpcResult.response));
  }

  const apiResult = await apiHandler.handle(c.req.raw, {
    prefix: "/api/reference",
    context: context,
  });

  if (apiResult.matched) {
    return withCompatHeaders(c.newResponse(apiResult.response.body, apiResult.response));
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

// Health, in two grades. Reports the running image tag so the updater UI can
// confirm the version actually changed, and the CLI floor alongside it so
// support can read both off one unauthenticated curl.
//
// `/health` (prod compose healthcheck) is a READINESS probe: it runs a real
// query through the same cache→Postgres path product reads use. During the
// od-664 wedge this exact process served a static 200 here for three days
// while every projects-page query hung: a healthcheck that touches nothing
// certifies nothing. 503 on failure so `docker ps` shows (unhealthy) and
// monitoring can alert or restart.
//
// `/api/health` (browser poll during self-update cutover, auth-excluded) stays
// a static LIVENESS payload on purpose: mid-cutover the new container may
// answer before its dependencies do, and the updater only needs "process up,
// which version", not "fully ready".
const healthPayload = {
  ok: true,
  version: env.OTTERDEPLOY_VERSION,
  minCliVersion: MIN_CLI_VERSION,
};
app.get("/health", async (c) => {
  const readiness = await checkReadiness();
  return c.json({ ...healthPayload, ...readiness }, readiness.ok ? 200 : 503);
});
app.get("/api/health", (c) => c.json(healthPayload));

// ─── Workbench: BullMQ dashboard (dev only) ────────────────────────
// The queue-inspection UI (every registry queue, incl. the builder's
// deploy.triggered) ships ONLY in dev: @getworkbench/hono is a devDependency,
// so a production image never installs it, and its heavy transitive deps
// (vite, @cloudflare/workerd, ~150MB) stay out of the image. The dynamic import
// lives behind the NODE_ENV gate so a production bundle never resolves it. It
// can also mutate jobs, so keeping it off in prod is safer. Registered here
// (before the SPA catch-all) so `/jobs` still routes ahead of it in dev.
if (env.NODE_ENV !== "production") {
  const { workbench } = await import("@getworkbench/hono");
  // Await: workbenchQueues also discovers named deploy-lane queues from Redis.
  app.route("/jobs", workbench({ queues: await workbenchQueues(), title: "otterdeploy jobs" }));
}

// Terminal websocket. Auth is NOT cookie-based here (od-5j8.9). The handler
// validates Origin and consumes a single-use ticket minted by the
// authenticated `terminal.mintTicket` oRPC call; see
// apps/server/src/handlers/terminal/ws.ts.
app.get("/pty", terminalWebSocketHandler);

app.post("/api/webhooks/github", githubWebhookHandler);
// Inbound trigger endpoints (Webhooks page). Public by design: auth is the
// per-endpoint HMAC signature + optional IP allowlist, verified in the
// handler; rides the same /api/webhooks/** identify exclusion as GitHub's.
app.post("/api/webhooks/in/:token", inboundWebhookHandler);
app.get("/api/integrations/github/install/callback", githubInstallCallbackHandler);
app.get("/api/integrations/github/manifest/callback", githubManifestCallbackHandler);

// ─── Health-agent ingest ────────────────────────────────────────────
// Per-node health reports from the swarm global agent service (Bearer HMAC
// token, verified in the handler). See docs/designs/server-health-agent.md.
app.post("/api/agent/health", agentHealthIngestHandler);

// One-time manual node enrollment. The high-entropy enrollment bearer is
// hashed in Postgres, single-use, expiring and role-scoped; completion rotates
// Docker's underlying role-wide join token.
app.post("/api/node-enrollments/:id/redeem", redeemNodeEnrollmentHandler);
app.post("/api/node-enrollments/:id/complete", completeNodeEnrollmentHandler);

// ─── Local source upload ───────────────────────────────────────────
// `otterdeploy deploy` streams a source tarball here for a `source: "upload"`
// service; the handler stages it on the shared data dir and enqueues the build
// (Bearer session token or org API key). Raw route: binary body. See
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
// Guest access (email one-time PIN), served on the deployment domain.
app.get("/.well-known/otterdeploy/access", deployAccessHandler);
app.post("/.well-known/otterdeploy/otp/request", deployOtpRequestHandler);
app.post("/.well-known/otterdeploy/otp/verify", deployOtpVerifyHandler);
// Access PIN (NetBird-style shared code), served on the deployment domain.
app.post("/.well-known/otterdeploy/pin/verify", deployPinVerifyHandler);

// ─── Static web dashboard (production single-image) ────────────────────────
// The published server image bundles the built SPA at ./public and serves it on
// the SAME origin as the API. Registered after every API/rpc/auth route so those
// win; `identify` only gates /api/**, so the shell + assets load unauthenticated
// and the client then calls the authenticated rpc/api. Unknown paths fall back
// to index.html so client-side (TanStack Router) deep links resolve. In dev the
// web app is served by Vite and ./public simply doesn't exist (these no-op).
app.use("/*", serveStatic({ root: "./public" }));
// A build asset that doesn't exist must 404, not fall through to index.html:
// the SPA fallback otherwise answers `/assets/whatever.wasm` with HTML and a
// 200, which turns "file missing from the image" into a silent runtime
// failure three layers away (a worker parsing HTML as wasm) instead of a
// visible fetch error. Assets are content-hashed and referenced only by built
// code, so no deep link ever legitimately lands here.
app.get("/assets/*", (c) => c.notFound());
app.get("/*", serveStatic({ path: "index.html", root: "./public" }));

// Live streams (deployment build logs, project events, container/task log
// tails) all run over oRPC event-iterators on /rpc. See packages/api. The
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
declare global {
  // `var` in `declare global` is how the property becomes visible on
  // `globalThis` without asserting a shape onto it.

  var __controlPlaneListener: { reload: (o: { fetch: typeof app.fetch }) => void } | undefined;
}
if (env.CONTROL_PLANE_PORT && env.CONTROL_PLANE_PORT !== env.PORT) {
  if (globalThis.__controlPlaneListener) {
    // --hot reloaded: swap the handler in place so the auth routes pick up
    // edits without a rebind (avoids both EADDRINUSE and stale code).
    globalThis.__controlPlaneListener.reload({ fetch: app.fetch });
  } else {
    globalThis.__controlPlaneListener = Bun.serve({
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
