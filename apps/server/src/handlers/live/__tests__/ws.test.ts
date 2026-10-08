/**
 * The live socket's upgrade gate.
 *
 * Same approach as the /pty tests: the real handler over `app.request`, for
 * the scenarios decided before `upgradeWebSocket` runs (a genuine upgrade
 * needs a live Bun server socket). The upgrade is cookie-authenticated, so
 * the Origin check is the cross-site WebSocket hijacking defence and has to
 * hold on its own.
 */
import type { ResolvedActor } from "@otterdeploy/api/context";

import { createLiveSocketRpcHandler } from "@otterdeploy/api/routers/live-socket-handler";
import { Result } from "better-result";
import { Hono } from "hono";
import { describe, expect, test } from "vite-plus/test";

import { createLiveSocketHandler } from "../ws";

const TRUSTED_ORIGIN = "https://deploy.example.com";

const sessionActor: ResolvedActor = {
  kind: "session",
  headers: new Headers(),
  user: { id: "user_1", email: "a@example.com", isInstallAdmin: false, twoFactorEnabled: false },
  session: { activeOrganizationId: "org_1" },
};

function app(actor: ResolvedActor | Error) {
  const a = new Hono();
  a.get(
    "/live/rpc",
    createLiveSocketHandler({
      trustedOrigins: [TRUSTED_ORIGIN],
      resolveActor: () => (actor instanceof Error ? Promise.reject(actor) : Promise.resolve(actor)),
      createContext: () => Promise.reject(new Error("no message is sent in these tests")),
      rpc: createLiveSocketRpcHandler({}),
    }),
  );
  return a;
}

function upgrade(actor: ResolvedActor | Error, origin?: string, host = "deploy.example.com") {
  const headers = new Headers({ upgrade: "websocket", connection: "Upgrade", host });
  if (origin !== undefined) headers.set("origin", origin);
  return app(actor).request("http://deploy.example.com/live/rpc", { headers });
}

describe("/live/rpc upgrade", () => {
  test("a cross-site page is refused even with a valid session cookie", async () => {
    const res = await upgrade(sessionActor, "https://evil.example.com");
    expect(res.status).toBe(403);
  });

  test("a trusted origin without a session is refused", async () => {
    const res = await upgrade(null, TRUSTED_ORIGIN);
    expect(res.status).toBe(401);
  });

  test("a session store that does not answer is a 503, not a 500 or a sign-out", async () => {
    const res = await upgrade(new Error("postgres did not answer"), TRUSTED_ORIGIN);
    expect(res.status).toBe(503);
  });

  test("a same-origin upgrade on an address CORS_ORIGIN does not list passes the gate", async () => {
    // The installer's bare `http://IP:3000`, the case this socket exists for.
    // It reaches the upgrade itself, which `app.request` cannot perform, so
    // the proof is that it was neither a 403 nor a 401.
    const headers = new Headers({
      upgrade: "websocket",
      connection: "Upgrade",
      host: "203.0.113.7:3000",
      origin: "http://203.0.113.7:3000",
    });
    const res = await Result.tryPromise({
      try: async () =>
        (await app(sessionActor).request("http://203.0.113.7:3000/live/rpc", { headers })).status,
      catch: () => "upgrade attempted",
    });
    const outcome = res.isOk() ? res.value : res.error;
    expect(outcome).not.toBe(403);
    expect(outcome).not.toBe(401);
  });

  test("a plain request is not an upgrade and falls through", async () => {
    const res = await app(sessionActor).request("http://deploy.example.com/live/rpc");
    expect(res.status).toBe(404);
  });
});
