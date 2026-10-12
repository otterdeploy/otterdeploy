import { METRIC_NAMES } from "@otterdeploy/otterd-proto";
import { idSchema } from "@otterdeploy/shared/id";
import { describe, expect, test } from "vite-plus/test";

import { decodeSampleBatch, type FrameContext, FrameInstallMismatchError } from "../frames";
import { KIND, METRIC_WIDTH, STATE } from "../model";

const ORG = "org_aaaaaaaaaaaaaaaaaaaaaaaa";
const NODE_ORG = idSchema.organization.parse("org_bbbbbbbbbbbbbbbbbbbbbbbb");
const T = 1_900_000_000_000;
const ctx: FrameContext = {
  installId: "inst-1",
  nodeOrganizationId: NODE_ORG,
  degradedAfterMs: (checkId) => (checkId === "slow" ? 1 : null),
};

function probe(over: Record<string, unknown> = {}, identity: Record<string, unknown> = {}) {
  return {
    identity: {
      installId: "inst-1",
      orgId: ORG,
      checkId: "chk",
      checkRevision: 2,
      subjectId: "svc",
      vantage: "serving-path",
      observerNodeId: "node-a",
      nodeEpoch: 4,
      bootId: "b-1",
      sampleSeq: 7,
      ...identity,
    },
    scheduledRound: 3,
    attempts: [
      { outcome: "success", cause: "ok", phase: "response", elapsedMs: 2, latencyUs: 1_200 },
    ],
    finalOutcome: "success",
    cause: "ok",
    failureDomain: "target",
    phase: "response",
    outcomePolicyRevision: 1,
    qualification: { state: "qualified" },
    observedAtUnixMs: T,
    elapsedMonotonicMs: 2,
    clockUncertaintyMs: 40,
    ttlMs: 135_000,
    latency: { connectUs: 300, totalUs: 1_200 },
    ...over,
  };
}

function metric(
  values: { name: string; value: number | null }[],
  identity: Record<string, unknown> = {},
) {
  return {
    identity: {
      installId: "inst-1",
      subjectId: "host",
      nodeId: "node-a",
      nodeEpoch: 4,
      bootId: "b-1",
      sampleSeq: 9,
      dimensionSet: "host",
      schemaVersion: 1,
      ...identity,
    },
    observedAtUnixMs: T,
    clockUncertaintyMs: 0,
    intervalMs: 30_000,
    ttlMs: 60_000,
    values,
  };
}

const frame = (over: Record<string, unknown> = {}) => ({
  batchId: "batch-1",
  nodeId: "node-a",
  nodeEpoch: 4,
  bootId: "b-1",
  live: true,
  probes: [probe()],
  ...over,
});

describe("telemetry frame boundary", () => {
  test("maps a probe result onto a normalized record: identity, state, latency, raw detail", () => {
    const { batch, refused } = decodeSampleBatch(frame(), ctx).unwrap();
    expect(refused).toBe(0);
    expect(batch.batchId).toBe("batch-1");
    expect(batch.source).toEqual({ sourceNodeId: "node-a", nodeEpoch: 4, bootId: "b-1" });
    expect(batch.live).toBe(true);
    expect(batch.records[0]).toMatchObject({
      series: {
        kind: "probe",
        organizationId: ORG,
        sourceNodeId: "node-a",
        checkId: "chk",
        vantage: "serving-path",
        generation: null,
      },
      t: T,
      seq: 7,
      state: STATE.healthy,
      uncMs: 40,
      ttlMs: 135_000,
      latUs: 1_200,
      attUs: [1_200],
      probe: { round: 3, outcome: 0, cause: 0 },
    });
  });

  test("failed and unqualified rounds are Down and Unknown, and never carry a latency", () => {
    const { batch } = decodeSampleBatch(
      frame({
        probes: [
          probe({ finalOutcome: "target-failure", cause: "target_timeout", attempts: [] }),
          probe(
            { qualification: { state: "unqualified", cause: "probe_capacity" } },
            { sampleSeq: 8 },
          ),
          probe({ finalOutcome: "configuration-error", cause: "missing_shell" }, { sampleSeq: 9 }),
        ],
      }),
      ctx,
    ).unwrap();
    expect(batch.records.map((r) => [r.state, r.latUs, r.attUs])).toEqual([
      [STATE.down, null, null],
      [STATE.unknown, null, null],
      [STATE.unknown, null, null],
    ]);
  });

  test("degraded comes from the check revision's threshold, not the wire", () => {
    const { batch } = decodeSampleBatch(
      frame({ probes: [probe({}, { checkId: "slow" })] }),
      ctx,
    ).unwrap();
    expect(batch.records[0]?.state).toBe(STATE.degraded);
  });

  test("named metric values land in contract order; null stays null; a missing org is the node's", () => {
    const { batch } = decodeSampleBatch(
      frame({
        probes: [],
        metrics: [
          metric([
            { name: "host.load.1", value: 0.5 },
            { name: "host.cpu.used_pct", value: 12 },
            { name: "host.mem.arc_bytes", value: null },
          ]),
        ],
      }),
      ctx,
    ).unwrap();
    const r = batch.records[0];
    expect(r?.series).toMatchObject({
      kind: "metric",
      organizationId: NODE_ORG,
      dimensionSet: "host",
    });
    expect(r?.vals?.slice(0, 6)).toEqual([12, null, null, null, null, 0.5]);
    expect(r?.vals?.[11]).toBeNull();
  });

  test("markers address the node's series by subject and dimension set, or the whole node", () => {
    const { batch } = decodeSampleBatch(
      frame({
        probes: [],
        markers: [
          { kind: "boot", atUnixMs: T, seq: 1 },
          { kind: "gap-start", atUnixMs: T, seq: 2, subjectId: "ctr-1" },
          { kind: "tombstone", atUnixMs: T, seq: 3, subjectId: "host", dimensionSet: "fs:/" },
        ],
      }),
      ctx,
    ).unwrap();
    expect(batch.markers).toEqual([
      { kind: KIND.boot, t: T, seq: 1, target: { kind: "node" } },
      {
        kind: KIND.gapStart,
        t: T,
        seq: 2,
        target: { kind: "subject", subjectId: "ctr-1", dimensionSet: null },
      },
      {
        kind: KIND.tombstone,
        t: T,
        seq: 3,
        target: { kind: "subject", subjectId: "host", dimensionSet: "fs:/" },
      },
    ]);
  });

  test("records from another boot or with a non-organization id are refused and counted", () => {
    const { batch, refused } = decodeSampleBatch(
      frame({
        probes: [
          probe({}, { bootId: "b-0" }),
          probe({}, { orgId: "not-an-org" }),
          probe({}, { sampleSeq: 11 }),
        ],
      }),
      ctx,
    ).unwrap();
    expect(refused).toBe(2);
    expect(batch.records).toHaveLength(1);
  });

  test("every contract metric name has a stored position", () => {
    expect(METRIC_NAMES.length).toBeLessThanOrEqual(METRIC_WIDTH);
  });

  test("a frame carrying another install's id is refused whole with a typed error", () => {
    const r = decodeSampleBatch(
      frame({ probes: [probe(), probe({}, { installId: "inst-2", sampleSeq: 8 })] }),
      ctx,
    );
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(FrameInstallMismatchError.is(r.error)).toBe(true);
      expect(r.error).toMatchObject({ expected: "inst-1", received: "inst-2" });
    }
    const metrics = decodeSampleBatch(
      frame({ probes: [], metrics: [metric([], { installId: "inst-9" })] }),
      ctx,
    );
    expect(metrics.isErr()).toBe(true);
  });

  test("a malformed frame is a typed error", () => {
    expect(decodeSampleBatch(frame({ live: "yes" }), ctx).isErr()).toBe(true);
    expect(
      decodeSampleBatch(frame({ probes: [probe({ cause: "GET /secret 500" })] }), ctx).isErr(),
    ).toBe(true);
  });
});
