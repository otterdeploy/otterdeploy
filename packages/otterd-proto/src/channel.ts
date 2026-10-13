/**
 * Control-channel frames; mirror of `channel.rs`. Frames are
 * lenient (a newer node may add informational fields); the signed documents
 * inside them are strict.
 */
import * as z from "zod";

import { capabilityError } from "./capability";
import { opOutcome } from "./command";
import { discoveryMessage } from "./discovery";
import { signedEnvelope } from "./envelope";
import { hostFacts } from "./identity";
import { leaseRequest, slotReport } from "./lifecycle";
import { batchDisposition, sampleBatch } from "./metrics";
import { keyId, nonce, u16, u32, u53, wireId } from "./primitives";
import { feature, versionRange } from "./version";

export const channelKind = z.enum(["control", "bulk"]);

export const channelLimits = z.strictObject({
  maxFrameBytes: u32,
  maxActiveCommands: u16,
  controlReserveBytes: u32,
  bulkQueueBytes: u32,
  streamWindowBytes: u32,
  maxStreams: u16,
  telemetryCredit: u32,
});
export type ChannelLimits = z.infer<typeof channelLimits>;

export const DEFAULT_LIMITS: ChannelLimits = {
  maxFrameBytes: 64 * 1024,
  maxActiveCommands: 16,
  controlReserveBytes: 256 * 1024,
  bulkQueueBytes: 2 * 1024 * 1024,
  streamWindowBytes: 256 * 1024,
  maxStreams: 16,
  telemetryCredit: 4_000,
};

/** What each end signs under `otterd/session/v1`; both cover both nonces. */
export const sessionProof = z.strictObject({
  role: z.enum(["hub", "node"]),
  channel: channelKind,
  protocol: u16,
  installId: wireId,
  sessionId: wireId,
  nodeId: wireId,
  nodeEpoch: u53,
  bootId: wireId,
  incarnation: wireId,
  nodeNonce: nonce,
  cpNonce: nonce,
});
export type SessionProof = z.infer<typeof sessionProof>;

export const rejectCode = z.enum([
  "unsupported-protocol",
  "unknown-node",
  "revoked",
  "stale-epoch",
  "wrong-install",
  "bad-proof",
  "rate-limited",
  "session-conflict",
  "maintenance",
]);

const requestRefusal = z.discriminatedUnion("code", [
  z.object({ code: z.literal("busy") }),
  z.object({ code: z.literal("duplicate-id") }),
  z.object({ code: z.literal("malformed"), detail: z.string() }),
  z.object({ code: z.literal("capability"), error: capabilityError }),
  z.object({ code: z.literal("verb-mismatch") }),
  z.object({ code: z.literal("op-mismatch") }),
]);

const f = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) =>
  z.object({ type: z.literal(type), ...shape });

export const controlFrame = z.discriminatedUnion("type", [
  f("hello", {
    protocol: versionRange,
    channel: channelKind,
    installId: wireId,
    nodeId: wireId,
    nodeEpoch: u53,
    keyEpoch: u53,
    identityKeyId: keyId,
    bootId: wireId,
    incarnation: wireId,
    otterdVersion: z.string(),
    journalFormat: u16,
    features: z.array(feature),
    nodeNonce: nonce,
    controlSessionId: wireId.optional(),
    facts: hostFacts.optional(),
  }),
  f("welcome", {
    protocol: u16,
    sessionId: wireId,
    cpNonce: nonce,
    authorityTerm: u53,
    cpUnixMs: u53,
    limits: channelLimits,
    features: z.array(feature),
    hubProof: signedEnvelope,
  }),
  f("reject", {
    code: rejectCode,
    message: z.string(),
    supported: versionRange.optional(),
    retryAfterMs: u53.optional(),
  }),
  f("authenticate", { sessionId: wireId, nodeProof: signedEnvelope }),
  f("ready", { sessionId: wireId }),
  f("request", { id: u32, capability: signedEnvelope, payload: z.string() }),
  f("cancel", { id: u32, reason: z.string() }),
  f("progress", {
    id: u32,
    opId: wireId,
    seq: u32,
    phase: z.string(),
    message: z.string().optional(),
  }),
  f("response", { id: u32, opId: wireId, duplicate: z.boolean(), outcome: opOutcome }),
  f("requestRefused", { id: u32, error: requestRefusal }),
  f("slotReports", {
    seq: u53,
    quarantined: z.boolean(),
    engineReachable: z.boolean(),
    slots: z.array(slotReport),
  }),
  f("leaseRequest", leaseRequest.shape),
  f("lease", { renewal: signedEnvelope }),
  f("telemetry", sampleBatch.shape),
  f("telemetryAck", { batchId: wireId, disposition: batchDisposition, credit: u32 }),
  f("discovery", { from: wireId, to: wireId, message: discoveryMessage }),
  f("authority", { document: signedEnvelope }),
  f("ping", { seq: u32, nodeMonoMs: u53 }),
  f("pong", { seq: u32, nodeMonoMs: u53, cpUnixMs: u53 }),
  f("goAway", { code: rejectCode, message: z.string(), reconnectAfterMs: u53.optional() }),
]);
export type ControlFrame = z.infer<typeof controlFrame>;
