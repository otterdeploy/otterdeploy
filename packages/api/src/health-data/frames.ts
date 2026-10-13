/**
 * The node telemetry boundary: decode an otterd `SampleBatch` frame and map it
 * onto the ingest's normalized records (./ingest-model.ts). This is the only
 * module that knows the wire shape; everything behind it works on normalized
 * records.
 *
 * Mapping decisions the contract drives:
 * - A probe's state comes from its final outcome after retries; a round whose
 *   qualification failed is Unknown. Degraded is not on the wire: it is a
 *   successful round slower than the check revision's `degradedAfterMs`, which
 *   the control plane looks up (`ctx.degradedAfterMs`).
 * - Only a successful round has a latency (`latency.totalUs`); failed and
 *   Unknown rounds never become 0 ms. Successful attempts feed the attempt
 *   sketch.
 * - Named metric values are stored positionally in `METRIC_NAMES` order; a
 *   null value stays null (not measured), never zero.
 * - A metric sample may omit its organization: it then belongs to the
 *   organization that owns the reporting node (`ctx.nodeOrganizationId`).
 * - Markers address the reporting node's series by subject and, optionally,
 *   dimension set; without a subject they cut every series of the node.
 * - Node signals are alerting input, not ledger data: counted, not ingested.
 * - The frame's batch id makes a resent frame a no-op at the ingest.
 * - A frame whose records carry another install's id is refused whole.
 * Records whose identity disagrees with the batch's node, epoch or boot, or
 * whose organization is not an organization id, are refused and counted.
 */
import type { JsonObject } from "@otterdeploy/shared/json";
import type * as z from "zod";

import {
  CAUSES,
  METRIC_NAMES,
  type metricSample,
  OUTCOMES,
  type ProbeResult,
  type SampleBatch,
  sampleBatch,
} from "@otterdeploy/otterd-proto";
import { idSchema, type OrganizationId } from "@otterdeploy/shared/id";
import { Result, TaggedError } from "better-result";

import type { IngestBatch, IngestMarker, IngestRecord } from "./ingest-model";

import { KIND, METRIC_WIDTH, STATE } from "./model";

type MetricSample = z.infer<typeof metricSample>;

class FrameDecodeError extends TaggedError("FrameDecodeError")<{ message: string }>() {}

/** A frame whose records name another install: refused whole, never partly ingested. */
export class FrameInstallMismatchError extends TaggedError("FrameInstallMismatchError")<{
  message: string;
  expected: string;
  received: string;
}>() {}

export interface FrameContext {
  /** This control plane's install id; every record must carry it. */
  installId: string;
  /** Organization owning the reporting node. */
  nodeOrganizationId: OrganizationId;
  /** A check revision's degraded threshold (ms), or null when it has none. */
  degradedAfterMs?: (checkId: string, checkRevision: number) => number | null;
}

export interface DecodedFrame {
  batch: IngestBatch;
  /** Records refused at the boundary (identity mismatch, invalid organization). */
  refused: number;
  /** Node signals carried by the frame (not ledger data). */
  signals: number;
}

const MARKER_KINDS = {
  tombstone: KIND.tombstone,
  boot: KIND.boot,
  "gap-start": KIND.gapStart,
  "gap-end": KIND.gapEnd,
  "maintenance-start": KIND.maintenanceStart,
  "maintenance-end": KIND.maintenanceEnd,
} as const;

const METRIC_POSITION = new Map<string, number>(METRIC_NAMES.map((name, i) => [name, i]));

function probeState(p: ProbeResult, ctx: FrameContext): IngestRecord["state"] {
  if (p.qualification.state === "unqualified") return STATE.unknown;
  if (p.finalOutcome === "target-failure") return STATE.down;
  if (p.finalOutcome !== "success") return STATE.unknown;
  const threshold = ctx.degradedAfterMs?.(p.identity.checkId, p.identity.checkRevision) ?? null;
  const total = p.latency.totalUs;
  return threshold !== null && total !== undefined && total > threshold * 1000
    ? STATE.degraded
    : STATE.healthy;
}

function probeRecord(
  p: ProbeResult,
  organizationId: OrganizationId,
  ctx: FrameContext,
): IngestRecord {
  const state = probeState(p, ctx);
  const success = state === STATE.healthy || state === STATE.degraded;
  const attempts = p.attempts.flatMap((a) =>
    a.outcome === "success" && a.latencyUs !== undefined ? [a.latencyUs] : [],
  );
  const detail: JsonObject = {
    phase: p.phase,
    failureDomain: p.failureDomain,
    qualification: p.qualification.state === "qualified" ? "qualified" : p.qualification.cause,
    outcomePolicyRevision: p.outcomePolicyRevision,
    elapsedMs: p.elapsedMonotonicMs,
    latencyUs: { ...p.latency },
    certificateExpiryUnixMs: p.certificateExpiryUnixMs,
    attempts: p.attempts.map((a) => ({ ...a })),
  };
  return {
    series: {
      kind: "probe",
      organizationId,
      sourceNodeId: p.identity.observerNodeId,
      checkId: p.identity.checkId,
      checkRevision: p.identity.checkRevision,
      subjectId: p.identity.subjectId,
      generation: p.identity.generation ?? null,
      attemptId: p.identity.attemptId ?? null,
      vantage: p.identity.vantage,
    },
    t: p.observedAtUnixMs,
    seq: p.identity.sampleSeq,
    state,
    uncMs: p.clockUncertaintyMs,
    ttlMs: p.ttlMs,
    latUs: success ? (p.latency.totalUs ?? null) : null,
    attUs: success && attempts.length > 0 ? attempts : null,
    vals: null,
    probe: {
      round: p.scheduledRound,
      outcome: OUTCOMES.indexOf(p.finalOutcome),
      cause: CAUSES.indexOf(p.cause),
      detail,
    },
  };
}

function metricRecord(m: MetricSample, organizationId: OrganizationId): IngestRecord {
  const vals: (number | null)[] = Array.from({ length: METRIC_WIDTH }, () => null);
  for (const { name, value } of m.values) {
    const at = METRIC_POSITION.get(name);
    if (at !== undefined) vals[at] = value;
  }
  return {
    series: {
      kind: "metric",
      organizationId,
      sourceNodeId: m.identity.nodeId,
      subjectId: m.identity.subjectId,
      generation: m.identity.generation ?? null,
      attemptId: m.identity.attemptId ?? null,
      dimensionSet: m.identity.dimensionSet,
      schemaVersion: m.identity.schemaVersion,
    },
    t: m.observedAtUnixMs,
    seq: m.identity.sampleSeq,
    state: STATE.healthy,
    uncMs: m.clockUncertaintyMs,
    ttlMs: m.ttlMs,
    latUs: null,
    attUs: null,
    vals,
    probe: null,
  };
}

function marker(m: NonNullable<SampleBatch["markers"]>[number]): IngestMarker {
  return {
    kind: MARKER_KINDS[m.kind],
    t: m.atUnixMs,
    seq: m.seq,
    target:
      m.subjectId === undefined
        ? { kind: "node" }
        : { kind: "subject", subjectId: m.subjectId, dimensionSet: m.dimensionSet ?? null },
  };
}

interface Origin {
  nodeId: string;
  nodeEpoch: number;
  bootId: string;
}
const sameOrigin = (a: Origin, b: Origin) =>
  a.nodeId === b.nodeId && a.nodeEpoch === b.nodeEpoch && a.bootId === b.bootId;

function toIngest(b: SampleBatch, ctx: FrameContext): DecodedFrame {
  const records: IngestRecord[] = [];
  let refused = 0;
  for (const p of b.probes ?? []) {
    const org = idSchema.organization.safeParse(p.identity.orgId);
    const origin = { ...p.identity, nodeId: p.identity.observerNodeId };
    if (!org.success || !sameOrigin(origin, b)) refused++;
    else records.push(probeRecord(p, org.data, ctx));
  }
  for (const m of b.metrics ?? []) {
    const org =
      m.identity.orgId === undefined
        ? { success: true as const, data: ctx.nodeOrganizationId }
        : idSchema.organization.safeParse(m.identity.orgId);
    if (!org.success || !sameOrigin(m.identity, b)) refused++;
    else records.push(metricRecord(m, org.data));
  }
  return {
    batch: {
      source: { sourceNodeId: b.nodeId, nodeEpoch: b.nodeEpoch, bootId: b.bootId },
      batchId: b.batchId,
      live: b.live,
      records,
      markers: (b.markers ?? []).map(marker),
    },
    refused,
    signals: b.signals?.length ?? 0,
  };
}

/** The first install id in the frame that is not this install's, if any. */
function foreignInstall(b: SampleBatch, installId: string): string | null {
  const ids = [
    ...(b.probes ?? []).map((p) => p.identity.installId),
    ...(b.metrics ?? []).map((m) => m.identity.installId),
  ];
  return ids.find((id) => id !== installId) ?? null;
}

/** Parse an untrusted telemetry frame and normalize it for the ingest. */
export function decodeSampleBatch(
  input: unknown,
  ctx: FrameContext,
): Result<DecodedFrame, FrameDecodeError | FrameInstallMismatchError> {
  const parsed = sampleBatch.safeParse(input);
  if (!parsed.success) return Result.err(new FrameDecodeError({ message: parsed.error.message }));
  const foreign = foreignInstall(parsed.data, ctx.installId);
  if (foreign !== null) {
    return Result.err(
      new FrameInstallMismatchError({
        message: `frame from install ${foreign}, expected ${ctx.installId}`,
        expected: ctx.installId,
        received: foreign,
      }),
    );
  }
  return Result.ok(toIngest(parsed.data, ctx));
}
