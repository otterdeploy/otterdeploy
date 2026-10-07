/**
 * The readiness gate's decisions, one per way a new version fails to become
 * ready: it listens on the wrong port, binds 127.0.0.1, crash-loops, boots
 * slowly, or never passes its healthcheck.
 */
import { describe, expect, test } from "vite-plus/test";

import {
  assessReadiness,
  DEFAULT_READY_TIMEOUT_MS,
  describeListeners,
  HEALTHCHECK_READY_MARGIN_MS,
  listenerProbe,
  MAX_READY_TIMEOUT_MS,
  parseListeners,
  READINESS_START,
  type ReadinessObservation,
  type ReadinessPlan,
  type ReadinessTrack,
  readinessPlan,
  readinessPort,
  READY_HOLD_MS,
  READY_MAX_RESTARTS,
} from "../readiness";

const PORT_PLAN: ReadinessPlan = readinessPlan({ healthcheck: null, port: 3000 });

function seen(overrides: Partial<ReadinessObservation>): ReadinessObservation {
  return {
    elapsedMs: 0,
    state: "running",
    exitCode: null,
    restartCount: 0,
    oomKilled: false,
    health: null,
    healthOutput: null,
    port: "open",
    ...overrides,
  };
}

/** Feed observations through the gate the way the driver's loop does. */
function run(plan: ReadinessPlan, observations: ReadinessObservation[]) {
  let track: ReadinessTrack = READINESS_START;
  for (const o of observations) {
    const verdict = assessReadiness(plan, o, track);
    if (verdict.kind !== "waiting") return verdict;
    track = verdict.track;
  }
  return { kind: "waiting" as const, track };
}

/** One observation per second from `fromMs` to `toMs`. */
function everySecond(
  fromMs: number,
  toMs: number,
  make: (ms: number) => Partial<ReadinessObservation>,
) {
  const out: ReadinessObservation[] = [];
  for (let ms = fromMs; ms <= toMs; ms += 1000) out.push(seen({ elapsedMs: ms, ...make(ms) }));
  return out;
}

describe("readinessPlan", () => {
  test("no healthcheck: the default window, the swarm-sized hold", () => {
    expect(PORT_PLAN).toEqual({
      timeoutMs: DEFAULT_READY_TIMEOUT_MS,
      holdMs: READY_HOLD_MS,
      port: 3000,
      healthcheck: false,
    });
  });

  test("a healthcheck's own worst case plus the margin, when that is longer", () => {
    // slow-start's: 180 s start period, 5 s interval, 3 s timeout, 3 retries.
    const plan = readinessPlan({
      healthcheck: { intervalMs: 5000, timeoutMs: 3000, retries: 3, startPeriodMs: 180_000 },
      port: 3000,
    });
    expect(plan.timeoutMs).toBe(180_000 + 8000 * 4 + HEALTHCHECK_READY_MARGIN_MS);
    expect(plan.healthcheck).toBe(true);
  });

  test("never longer than the ceiling", () => {
    const plan = readinessPlan({
      healthcheck: { intervalMs: 60_000, timeoutMs: 30_000, retries: 50, startPeriodMs: 3_600_000 },
      port: null,
    });
    expect(plan.timeoutMs).toBe(MAX_READY_TIMEOUT_MS);
  });

  test("the probed port: primary first, then the first TCP port, none for UDP-only", () => {
    expect(
      readinessPort([
        { containerPort: 9090, protocol: "tcp" },
        { containerPort: 3000, protocol: "tcp", isPrimary: true },
      ]),
    ).toBe(3000);
    expect(readinessPort([{ containerPort: 8080, protocol: "tcp" }])).toBe(8080);
    expect(readinessPort([{ containerPort: 3478, protocol: "udp" }])).toBeNull();
    expect(readinessPort([])).toBeNull();
  });
});

describe("assessReadiness", () => {
  test("express: ready only after holding ready for the full hold", () => {
    const early = run(
      PORT_PLAN,
      everySecond(0, READY_HOLD_MS - 1000, () => ({})),
    );
    expect(early.kind).toBe("waiting");
    const held = run(
      PORT_PLAN,
      everySecond(0, READY_HOLD_MS, () => ({})),
    );
    expect(held).toEqual({ kind: "ready" });
  });

  test("port-mismatch / binds-localhost: a closed port fails at the window, naming the port", () => {
    const verdict = run(
      PORT_PLAN,
      everySecond(0, DEFAULT_READY_TIMEOUT_MS, () => ({ port: "closed" })),
    );
    expect(verdict.kind).toBe("failed");
    expect(verdict.kind === "failed" && verdict.reason).toBe(
      "never became ready: nothing accepted a connection on port 3000 within 120s",
    );
  });

  test("crash-loop: serving between crashes never completes the hold, the restarts fail it", () => {
    // Up for 2 s, then exits 1 and is restarted, over and over.
    const verdict = run(
      PORT_PLAN,
      everySecond(0, 60_000, (ms) => {
        const cycle = Math.floor(ms / 3000);
        const up = ms % 3000 < 2000;
        return up
          ? { restartCount: cycle }
          : { state: "restarting", exitCode: 1, restartCount: cycle, port: "closed" };
      }),
    );
    expect(verdict).toEqual({
      kind: "failed",
      reason: `kept crashing: exited with code 1 and restarted ${READY_MAX_RESTARTS} times before it became ready`,
    });
  });

  test("a restart in the middle of the hold starts it over", () => {
    const verdict = run(PORT_PLAN, [
      seen({ elapsedMs: 0 }),
      seen({ elapsedMs: 9000 }),
      seen({ elapsedMs: 9500, restartCount: 1 }),
      seen({ elapsedMs: 15_000, restartCount: 1 }),
    ]);
    expect(verdict.kind).toBe("waiting");
    expect(verdict.kind === "waiting" && verdict.track.readySinceMs).toBe(9500);
  });

  test("a crash that gave up fails at once, with the exit code", () => {
    expect(run(PORT_PLAN, [seen({ state: "exited", exitCode: 1, restartCount: 2 })])).toEqual({
      kind: "failed",
      reason: "crashed: exited with code 1 after 2 restarts before it became ready",
    });
    expect(run(PORT_PLAN, [seen({ state: "missing" })]).kind).toBe("failed");
    expect(run(PORT_PLAN, [seen({ oomKilled: true, state: "exited" })])).toEqual({
      kind: "failed",
      reason: "was killed for running out of memory (OOM) before it became ready",
    });
  });

  test("never-healthy: an unhealthy healthcheck fails at once, with its output", () => {
    const plan = readinessPlan({
      healthcheck: { intervalMs: 5000, timeoutMs: 3000, retries: 3, startPeriodMs: 10_000 },
      port: 3000,
    });
    const verdict = run(plan, [
      seen({ elapsedMs: 5000, health: "starting" }),
      seen({ elapsedMs: 25_000, health: "unhealthy", healthOutput: "GET /healthz -> 503\n" }),
    ]);
    expect(verdict).toEqual({
      kind: "failed",
      reason: "failed its healthcheck: GET /healthz -> 503",
    });
  });

  test("slow-start: waits out a 90 s boot inside the declared start period, then holds", () => {
    const plan = readinessPlan({
      healthcheck: { intervalMs: 5000, timeoutMs: 3000, retries: 3, startPeriodMs: 180_000 },
      port: 3000,
    });
    const verdict = run(
      plan,
      everySecond(0, 120_000, (ms) =>
        ms < 95_000
          ? { health: "starting", port: ms < 90_000 ? "closed" : "open" }
          : { health: "healthy" },
      ),
    );
    expect(verdict).toEqual({ kind: "ready" });
  });

  test("a healthcheck that never reports healthy fails at its window", () => {
    const plan = readinessPlan({
      healthcheck: { intervalMs: 1000, timeoutMs: 1000, retries: 1, startPeriodMs: 0 },
      port: null,
    });
    const verdict = run(plan, [seen({ elapsedMs: plan.timeoutMs, health: "starting" })]);
    expect(verdict).toEqual({
      kind: "failed",
      reason: "never became healthy within 120s (healthcheck still starting)",
    });
  });

  test("an unavailable probe never blocks: the gate falls back to container state", () => {
    expect(
      run(
        PORT_PLAN,
        everySecond(0, READY_HOLD_MS, () => ({ port: "unavailable" })),
      ),
    ).toEqual({ kind: "ready" });
  });

  test("a worker with no port only has to stay up", () => {
    const plan = readinessPlan({ healthcheck: null, port: null });
    expect(
      run(
        plan,
        everySecond(0, READY_HOLD_MS, () => ({ port: null })),
      ),
    ).toEqual({
      kind: "ready",
    });
  });
});

// /proc/net/tcp + tcp6 as a container prints them (columns trimmed after `st`).
const PROC_PORT_MISMATCH = `  sl  local_address rem_address   st
   0: 00000000:0BB9 00000000:0000 0A
   1: 0B00000A:A1F2 0B00000A:0050 01
  sl  local_address                         remote_address                        st
`;
const PROC_LOCALHOST = `  sl  local_address rem_address   st
   0: 0100007F:0BB8 00000000:0000 0A
`;
const PROC_V6_WILDCARD = `  sl  local_address                         remote_address                        st
   0: 00000000000000000000000000000000:0BB8 00000000000000000000000000000000:0000 0A
`;

describe("listening sockets", () => {
  test("parses listening sockets only, decoding v4 and v6 addresses", () => {
    expect(parseListeners(PROC_PORT_MISMATCH)).toEqual([{ address: "0.0.0.0", port: 3001 }]);
    expect(parseListeners(PROC_LOCALHOST)).toEqual([{ address: "127.0.0.1", port: 3000 }]);
    expect(parseListeners(PROC_V6_WILDCARD)).toEqual([{ address: "::", port: 3000 }]);
    expect(
      parseListeners(
        "  0: 0000000000000000FFFF00000100007F:0BB8 00000000000000000000000000000000:0000 0A\n  1: 00000000000000000000000001000000:1F90 0 0A",
      ),
    ).toEqual([
      { address: "::ffff:127.0.0.1", port: 3000 },
      { address: "::1", port: 8080 },
    ]);
  });

  test("reachable from the edge only when bound beyond loopback", () => {
    expect(listenerProbe(parseListeners(PROC_LOCALHOST), 3000)).toBe("closed");
    expect(listenerProbe(parseListeners(PROC_V6_WILDCARD), 3000)).toBe("open");
    expect(listenerProbe(parseListeners(PROC_PORT_MISMATCH), 3000)).toBe("closed");
  });

  test("says what the app listens on instead", () => {
    expect(describeListeners(parseListeners(PROC_PORT_MISMATCH), 3000)).toBe(
      "the app is listening on 0.0.0.0:3001 instead: make it listen on port 3000 (or change the service's port)",
    );
    expect(describeListeners(parseListeners(PROC_LOCALHOST), 3000)).toBe(
      "port 3000 is bound to 127.0.0.1 only, so nothing outside the container can reach it: listen on 0.0.0.0:3000",
    );
    expect(describeListeners([], 3000)).toBe("the app is not listening on any TCP port");
    expect(describeListeners(null, 3000)).toBeNull();
  });
});
