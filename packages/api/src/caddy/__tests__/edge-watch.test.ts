/**
 * A Caddy restart left every app route 503 until the server was restarted
 * by hand. Caddy came back from the stub Caddyfile and nothing re-pushed
 * the routes. The edge watch notices the config changed under it and
 * reconciles.
 */
import { Result } from "better-result";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { loadCaddyfile, readCaddyConfig } from "../client";
import {
  controlPlaneEdgeWatch,
  createEdgeWatch,
  EDGE_WATCH_INTERVAL_MS,
  EDGE_WATCH_MAX_BACKOFF_MS,
  startEdgeWatch,
} from "../edge-watch";

/** A database whose routes never change: the revision every reconcile records. */
const unchangedRoutes = async () => Result.ok("rev-1");

/** What the compose stub boots Caddy with (docker-compose.prod.yml). */
const STUB =
  '{"apps":{"http":{"servers":{"srv0":{"routes":[{"handle":[{"body":"otterdeploy is starting…","handler":"static_response","status_code":503}]}]}}}}}';

/**
 * A stand-in for Caddy's admin API on a Unix socket, the transport the
 * control plane uses: `/load` replaces the running config, `GET /config/`
 * returns it, and `restart()` is the container coming back from the stub.
 */
function fakeCaddyAdmin() {
  const dir = mkdtempSync(join(tmpdir(), "edge-watch-"));
  const socket = join(dir, "admin.sock");
  const state = { config: STUB, loads: 0 };
  const server = Bun.serve({
    unix: socket,
    async fetch(request) {
      const url = new URL(request.url);
      if (request.method === "POST" && url.pathname === "/load") {
        // Caddy stores the adapted JSON; any stable rendering will do here.
        state.config = JSON.stringify({ loaded: await request.text() });
        state.loads += 1;
        return new Response(null, { status: 200 });
      }
      if (request.method === "GET" && url.pathname === "/config/") {
        return new Response(`${state.config}\n`, { status: 200 });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return {
    adminUrl: `unix://${socket}`,
    state,
    restart: () => {
      state.config = STUB;
    },
    close: () => {
      void server.stop(true);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe("edge watch against a Caddy admin socket", () => {
  let caddy: ReturnType<typeof fakeCaddyAdmin>;
  beforeEach(() => {
    caddy = fakeCaddyAdmin();
  });
  afterEach(() => caddy.close());

  test("routes are pushed again after Caddy restarts from the stub config", async () => {
    const watch = createEdgeWatch({
      readConfig: () => readCaddyConfig(caddy.adminUrl),
      now: () => performance.now(),
    });
    const routes = "app.example.com {\n  reverse_proxy app:80\n}\n";
    const reconcile = vi.fn(async () => {
      const loaded = await loadCaddyfile(routes, caddy.adminUrl);
      if (loaded.ok) await watch.recordLoaded("rev-1");
      return loaded.ok ? {} : { loadError: loaded.error };
    });

    // Server boot: the bootstrap reconcile.
    await reconcile();
    expect(await watch.tick(reconcile, unchangedRoutes)).toEqual({ kind: "in-sync" });
    expect(reconcile).toHaveBeenCalledTimes(1);

    caddy.restart();
    expect(await watch.tick(reconcile, unchangedRoutes)).toEqual({
      kind: "reconciled",
      reason: "config-changed",
    });
    expect(caddy.state.config).toContain("app.example.com");
    expect(await watch.tick(reconcile, unchangedRoutes)).toEqual({ kind: "in-sync" });
    expect(caddy.state.loads).toBe(2);
  });

  test("a Caddy that resumed its own autosave is left alone", async () => {
    const watch = createEdgeWatch({
      readConfig: () => readCaddyConfig(caddy.adminUrl),
      now: () => performance.now(),
    });
    const reconcile = vi.fn(async () => {
      await loadCaddyfile("app.example.com\n", caddy.adminUrl);
      await watch.recordLoaded("rev-1");
      return {};
    });
    await reconcile();
    // `--resume`: the restarted Caddy runs exactly what was loaded before.
    const before = caddy.state.config;
    caddy.restart();
    caddy.state.config = before;
    expect(await watch.tick(reconcile, unchangedRoutes)).toEqual({ kind: "in-sync" });
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  test("a route another process wrote reaches the edge on the next tick", async () => {
    // The build worker seeds a git compose stack's public route. Its own
    // reconcile cannot reach the admin socket (the socket is mounted into the
    // server only), so Caddy keeps running the old config and the host fails
    // its TLS handshake. Caddy's config is unchanged, so only the database
    // says anything moved.
    const watch = createEdgeWatch({
      readConfig: () => readCaddyConfig(caddy.adminUrl),
      now: () => performance.now(),
    });
    const db = { revision: "rev-1", routes: "app.example.com {\n  reverse_proxy app:80\n}\n" };
    const readDesired = async () => Result.ok(db.revision);
    const reconcile = vi.fn(async () => {
      const revision = db.revision;
      const loaded = await loadCaddyfile(db.routes, caddy.adminUrl);
      if (loaded.ok) await watch.recordLoaded(revision);
      return loaded.ok ? {} : { loadError: loaded.error };
    });
    await reconcile();
    expect(await watch.tick(reconcile, readDesired)).toEqual({ kind: "in-sync" });

    // The builder's write: a new row, no load.
    db.revision = "rev-2";
    db.routes += "stack-app.example.com {\n  reverse_proxy od-stack-app:3000\n}\n";

    expect(await watch.tick(reconcile, readDesired)).toEqual({
      kind: "reconciled",
      reason: "routes-changed",
    });
    expect(caddy.state.config).toContain("stack-app.example.com");
    expect(await watch.tick(reconcile, readDesired)).toEqual({ kind: "in-sync" });
    expect(reconcile).toHaveBeenCalledTimes(2);
  });

  test("a database that cannot be read leaves a running edge alone", async () => {
    const watch = createEdgeWatch({
      readConfig: () => readCaddyConfig(caddy.adminUrl),
      now: () => performance.now(),
    });
    const reconcile = vi.fn(async () => {
      await loadCaddyfile("app.example.com\n", caddy.adminUrl);
      await watch.recordLoaded("rev-1");
      return {};
    });
    await reconcile();
    const outcome = await watch.tick(reconcile, async () =>
      Result.err(new Error("connection terminated")),
    );
    expect(outcome).toEqual({ kind: "desired-unreadable", error: "connection terminated" });
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  test("an admin API that answers with an error is unreachable, not drift", async () => {
    const broken = Bun.serve({
      port: 0,
      fetch: () => new Response("admin endpoint disabled", { status: 500 }),
    });
    const watch = createEdgeWatch({
      readConfig: () => readCaddyConfig(`http://127.0.0.1:${broken.port}`),
      now: () => performance.now(),
    });
    const reconcile = vi.fn(async () => ({}));
    const outcome = await watch.tick(reconcile, unchangedRoutes);
    void broken.stop(true);
    expect(outcome).toMatchObject({ kind: "unreachable" });
    expect(outcome.kind === "unreachable" && outcome.error).toContain("HTTP 500");
    expect(reconcile).not.toHaveBeenCalled();
  });

  test("an admin socket that is not there yet is waited out, not reconciled against", async () => {
    caddy.close();
    const watch = createEdgeWatch({
      readConfig: () => readCaddyConfig(caddy.adminUrl),
      now: () => performance.now(),
    });
    const reconcile = vi.fn(async () => ({}));
    const outcome = await watch.tick(reconcile, unchangedRoutes);
    expect(outcome.kind).toBe("unreachable");
    expect(reconcile).not.toHaveBeenCalled();
  });
});

describe("createEdgeWatch", () => {
  function scripted(configs: string[]) {
    let clock = 0;
    const watch = createEdgeWatch({
      readConfig: async () => Result.ok(configs.shift() ?? "same"),
      now: () => clock,
    });
    return { watch, advance: (ms: number) => (clock += ms) };
  }

  test("reconciles when nothing has been loaded since boot", async () => {
    const { watch } = scripted(["stub"]);
    const reconcile = vi.fn(async () => ({}));
    expect(await watch.tick(reconcile, unchangedRoutes)).toEqual({
      kind: "reconciled",
      reason: "never-loaded",
    });
  });

  test("a config Caddy keeps refusing backs off instead of reloading every tick", async () => {
    const { watch, advance } = scripted([]);
    const reconcile = vi.fn(async () => ({ loadError: "adapt: unknown directive" }));
    const first = await watch.tick(reconcile, unchangedRoutes);
    expect(first).toMatchObject({
      kind: "reconcile-failed",
      retryInMs: 2 * EDGE_WATCH_INTERVAL_MS,
    });

    advance(EDGE_WATCH_INTERVAL_MS);
    expect((await watch.tick(reconcile, unchangedRoutes)).kind).toBe("backoff");
    expect(reconcile).toHaveBeenCalledTimes(1);

    advance(EDGE_WATCH_INTERVAL_MS);
    expect(await watch.tick(reconcile, unchangedRoutes)).toMatchObject({
      kind: "reconcile-failed",
      retryInMs: 4 * EDGE_WATCH_INTERVAL_MS,
    });
    expect(reconcile).toHaveBeenCalledTimes(2);
  });

  test("the backoff stops growing at its ceiling", async () => {
    const { watch, advance } = scripted([]);
    const reconcile = vi.fn(async () => ({ loadError: "refused" }));
    let last = await watch.tick(reconcile, unchangedRoutes);
    for (let i = 0; i < 10; i++) {
      advance(EDGE_WATCH_MAX_BACKOFF_MS);
      last = await watch.tick(reconcile, unchangedRoutes);
    }
    expect(last).toMatchObject({ kind: "reconcile-failed", retryInMs: EDGE_WATCH_MAX_BACKOFF_MS });
  });

  test("a reconcile that throws is a failed reconcile, not a crashed watch", async () => {
    const { watch } = scripted([]);
    const outcome = await watch.tick(async () => {
      throw new Error("Postgres is down");
    }, unchangedRoutes);
    expect(outcome).toMatchObject({ kind: "reconcile-failed", error: "Postgres is down" });
  });

  test("ticks do not overlap", async () => {
    const { watch } = scripted([]);
    let release = () => {};
    const slow = vi.fn(
      () =>
        new Promise<{ loadError?: string }>((resolve) => {
          release = () => resolve({});
        }),
    );
    const first = watch.tick(slow, unchangedRoutes);
    await Promise.resolve();
    expect(await watch.tick(slow, unchangedRoutes)).toEqual({ kind: "busy" });
    release();
    expect((await first).kind).toBe("reconciled");
    expect(slow).toHaveBeenCalledTimes(1);
  });
});

describe("startEdgeWatch", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("compares the control-plane edge every interval until stopped", async () => {
    vi.useFakeTimers();
    const tick = vi
      .spyOn(controlPlaneEdgeWatch, "tick")
      .mockResolvedValue({ kind: "reconciled", reason: "config-changed" });
    const reconcile = vi.fn(async () => ({}));
    const stop = startEdgeWatch(reconcile, unchangedRoutes);
    await vi.advanceTimersByTimeAsync(EDGE_WATCH_INTERVAL_MS - 1);
    expect(tick).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(tick).toHaveBeenCalledWith(reconcile, unchangedRoutes);
    await vi.advanceTimersByTimeAsync(EDGE_WATCH_INTERVAL_MS);
    expect(tick).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(EDGE_WATCH_INTERVAL_MS * 3);
    expect(tick).toHaveBeenCalledTimes(2);
  });
});
