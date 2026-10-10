/**
 * The update watchdog against a Docker daemon that accepts the connection and
 * never answers.
 *
 * The watchdog used to check its 15-minute deadline only BETWEEN polls, on a
 * client with no timeout: one inspect that never came back held it forever,
 * the run stayed "running", and every later apply answered "already-running".
 * Here the client is deliberately unbounded (no request timeout at all), so
 * the only thing that can end the watch is the watchdog's own deadline, and
 * the per-call ceiling is set far above that deadline: the run must settle on
 * the deadline, mid-call.
 */
import type { Server } from "bun";

import { Docker } from "@otterdeploy/docker";
import { Temporal } from "@otterdeploy/shared/temporal";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { STALE_RUN_MS, settleStaleRun } from "../apply";
import * as state from "../state";
import {
  WATCH_CALL_TIMEOUT_MS,
  WATCH_DEADLINE_MS,
  WATCH_DEFAULTS,
  WATCH_POLL_MS,
  watchCutover,
} from "../watch-cutover";

/** A Docker Engine API stand-in on a unix socket: "hang" accepts a request
 *  and never answers it, "error" answers every request with a 500. */
function startFakeDocker(initial: "hang" | "error") {
  const dir = mkdtempSync(join(tmpdir(), "watch-docker-"));
  const socketPath = join(dir, "docker.sock");
  let fault = initial;
  const requests: string[] = [];
  const hung: Array<() => void> = [];
  const reply = (status: number, message: string) => Response.json({ message }, { status });
  const server: Server<undefined> = Bun.serve({
    unix: socketPath,
    fetch: (request) => {
      const url = new URL(request.url);
      requests.push(`${request.method} ${url.pathname}`);
      if (fault === "hang") {
        return new Promise<Response>((resolve) => {
          hung.push(() => resolve(reply(503, "released at teardown")));
        });
      }
      return reply(500, "daemon error");
    },
  });
  return {
    host: `unix://${socketPath}`,
    requests,
    setFault: (next: "hang" | "error") => {
      fault = next;
    },
    stop: () => {
      for (const release of hung) release();
      void server.stop(true);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const fake = startFakeDocker("hang");
afterAll(() => fake.stop());

function unboundedClient(): Docker {
  return new Docker({
    transport: { type: "unix", socketPath: fake.host.replace(/^unix:\/\//, "") },
  });
}

describe("update watchdog on a wedged daemon", () => {
  it(
    "settles the run as failed on its deadline even while a Docker call is hung",
    { timeout: 10_000 },
    async () => {
      fake.setFault("hang");
      fake.requests.length = 0;
      state.begin("v99.0.0");
      state.markHandoff();

      const startedAt = Temporal.Now.instant();
      await watchCutover(unboundedClient(), "helper-id", "v99.0.0", {
        pollMs: 10,
        deadlineMs: 300,
        callTimeoutMs: 1_000,
      });
      const tookMs = Temporal.Now.instant().epochMilliseconds - startedAt.epochMilliseconds;

      expect(fake.requests.some((r) => r.includes("/containers/helper-id/json"))).toBe(true);
      // Deadline (300ms) + one best-effort remove (1s ceiling) + slack.
      expect(tookMs).toBeLessThan(3_000);
      expect(state.isRunning()).toBe(false);
      const snap = state.snapshot();
      expect(snap.status).toBe("failed");
      expect(snap.error).toMatch(/did not complete within/);
    },
  );

  it("treats a daemon error as transient and still settles on the deadline", async () => {
    fake.setFault("error");
    state.begin("v99.0.1");
    await watchCutover(unboundedClient(), "helper-id", "v99.0.1", {
      pollMs: 10,
      deadlineMs: 150,
      callTimeoutMs: 1_000,
    });
    expect(state.snapshot().status).toBe("failed");
  });
});

describe("the shipped watchdog bounds", () => {
  it("bound every Docker call well inside the deadline, and poll well inside a call", () => {
    expect(WATCH_DEFAULTS).toEqual({
      pollMs: WATCH_POLL_MS,
      deadlineMs: WATCH_DEADLINE_MS,
      callTimeoutMs: WATCH_CALL_TIMEOUT_MS,
    });
    expect(WATCH_DEADLINE_MS).toBe(15 * 60_000);
    expect(WATCH_CALL_TIMEOUT_MS * 10).toBeLessThan(WATCH_DEADLINE_MS);
    expect(WATCH_POLL_MS).toBeLessThan(WATCH_CALL_TIMEOUT_MS);
  });
});

describe("a run nobody settled", () => {
  it("is released before a new apply once it outlives STALE_RUN_MS", () => {
    expect(STALE_RUN_MS).toBeGreaterThan(WATCH_DEADLINE_MS);
    state.begin("v99.3.0");
    const started = Temporal.Instant.from(state.snapshot().startedAt ?? "");
    settleStaleRun(started.add({ milliseconds: STALE_RUN_MS - 1_000 }));
    expect(state.isRunning(), "a run inside the limit is not stale").toBe(true);

    settleStaleRun(started.add({ milliseconds: STALE_RUN_MS }));
    expect(state.isRunning()).toBe(false);
    const snap = state.snapshot();
    expect(snap.status).toBe("failed");
    expect(snap.error).toMatch(/was marked failed.*start the update again/);
  });

  it("is failed with a reason once it is older than the limit, so a new apply can start", () => {
    state.begin("v99.1.0");
    const started = Temporal.Instant.from(state.snapshot().startedAt ?? "");

    const early = started.add({ minutes: 29 });
    expect(state.expireIfOlderThan(30 * 60_000, "stale", early)).toBe(false);
    expect(state.isRunning()).toBe(true);

    const late = started.add({ minutes: 31 });
    expect(state.expireIfOlderThan(30 * 60_000, "stale: start the update again", late)).toBe(true);
    expect(state.isRunning()).toBe(false);
    const snap = state.snapshot();
    expect(snap.status).toBe("failed");
    expect(snap.error).toBe("stale: start the update again");
    expect(snap.logs.at(-1)?.level).toBe("error");
  });

  it("leaves a settled run alone", () => {
    state.begin("v99.2.0");
    state.finish(true);
    const far = Temporal.Now.instant().add({ hours: 5 });
    expect(state.expireIfOlderThan(1, "stale", far)).toBe(false);
    expect(state.snapshot().status).toBe("succeeded");
  });
});
