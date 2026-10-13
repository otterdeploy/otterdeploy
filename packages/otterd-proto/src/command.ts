/**
 * Command payloads, results and operation outcomes; mirror of `command.rs`.
 *
 * Frozen arguments: lifecycle verbs, `op.*`, `node.*`, `metrics.sample`,
 * `health.configure`, and the stream binding. The storage, backup, firewall,
 * proxy and platform-update arguments are provisional and owned by those components.
 */
import * as z from "zod";

import { capabilityError, verb } from "./capability";
import { sha256HexOf, signedEnvelope } from "./envelope";
import { healthCheck } from "./health";
import { barrierEvidence, engineRestartPolicy, slotGrant, slotReport } from "./lifecycle";
import { sha256Hex, u16, u32, u53, wireId } from "./primitives";
import { envVar, serviceSpec } from "./spec";

export const streamBinding = z.strictObject({
  streamId: u32,
  direction: z.enum(["out", "in", "duplex"]),
  maxBytes: u53,
  sha256: sha256Hex.optional(),
  deadlineUnixMs: u53.optional(),
  tty: z.strictObject({ cols: u16, rows: u16 }).optional(),
});
export type StreamBinding = z.infer<typeof streamBinding>;

/** A document owned by another component, carried as exact bytes; `digest` = SHA-256(body). */
export const opaqueDocument = z.strictObject({
  schema: z.string(),
  body: z.string(),
  digest: sha256Hex,
});

const v = <V extends string, S extends z.ZodRawShape>(name: V, shape: S) =>
  z.strictObject({ verb: z.literal(name), ...shape });

const stream = { stream: streamBinding };

export const command = z.discriminatedUnion("verb", [
  // Frozen: lifecycle.
  v("workload.apply", { grant: slotGrant, spec: serviceSpec }),
  v("workload.restart", { grantId: wireId, reason: z.string() }),
  v("workload.stop", { grantId: wireId, reason: z.string(), stopGraceMs: u53.optional() }),
  v("workload.remove", { grantId: wireId }),
  v("workload.release-adoption", { grantId: wireId, restartPolicy: engineRestartPolicy }),
  v("workload.inspect", { resourceId: wireId.optional(), grantIds: z.array(wireId).optional() }),
  v("workload.logs", {
    resourceId: wireId,
    grantId: wireId.optional(),
    attemptId: wireId.optional(),
    sinceUnixMs: u53.optional(),
    tail: u32.optional(),
    follow: z.boolean(),
    ...stream,
  }),
  v("job.run", { grant: slotGrant, spec: serviceSpec, runId: wireId }),
  v("op.status", { opId: wireId }),
  // Frozen: node.
  v("node.details", {}),
  v("node.health", {}),
  v("node.units", {}),
  v("node.reclaim", {
    targets: z.array(z.enum(["images", "build-cache", "containers", "branch-pool"])),
  }),
  v("node.upgrade", { release: signedEnvelope }),
  v("node.decommission", { reason: z.string() }),
  v("node.reenroll", { certificate: signedEnvelope }),
  v("node.retireByBarrier", { evidence: barrierEvidence }),
  v("metrics.sample", { cacheMs: u53, includeDetails: z.boolean() }),
  v("events.subscribe", { sinceCursor: z.string().optional(), ...stream }),
  v("health.configure", { revision: u53, checks: z.array(healthCheck) }),
  // Provisional: containers.
  v("container.list", { all: z.boolean(), managedOnly: z.boolean() }),
  v("container.inspect", { container: wireId }),
  v("container.logs", {
    container: wireId,
    sinceUnixMs: u53.optional(),
    tail: u32.optional(),
    follow: z.boolean(),
    ...stream,
  }),
  v("container.exec", {
    container: wireId,
    attemptId: wireId.optional(),
    argv: z.array(z.string()),
    user: z.string().optional(),
    workdir: z.string().optional(),
    env: z.array(envVar).optional(),
    ...stream,
  }),
  // Provisional: images.
  v("image.pull", {
    reference: z.string(),
    digest: z.string().optional(),
    registryAuthRef: z.string().optional(),
  }),
  v("image.push", { reference: z.string(), registryAuthRef: z.string().optional() }),
  v("image.inspect", { reference: z.string() }),
  v("image.list", {}),
  v("image.remove", { reference: z.string() }),
  v("image.prune", {}),
  // Provisional: networks.
  v("network.list", {}),
  v("network.inspect", { name: z.string() }),
  v("network.ensure", {
    name: z.string(),
    scopeId: wireId.optional(),
    subnet: z.string().optional(),
    internal: z.boolean(),
    labels: z.record(z.string(), z.string()).optional(),
  }),
  v("network.connect", {
    network: z.string(),
    container: wireId,
    aliases: z.array(z.string()).optional(),
  }),
  v("network.disconnect", { network: z.string(), container: wireId }),
  v("network.remove", { name: z.string() }),
  // Provisional: volumes and storage.
  v("volume.list", {}),
  v("volume.inspect", { name: z.string() }),
  v("volume.create", {
    name: z.string(),
    dataIdentity: wireId.optional(),
    labels: z.record(z.string(), z.string()).optional(),
  }),
  v("volume.remove", { name: z.string() }),
  v("volume.fs", { volume: z.string(), path: z.string() }),
  v("volume.export", { volume: z.string(), path: z.string(), ...stream }),
  v("volume.import", { volume: z.string(), path: z.string(), ...stream }),
  v("volume.snapshot", { volume: z.string(), snapshot: z.string() }),
  v("volume.clone", { source: z.string(), target: z.string(), dataIdentity: wireId }),
  v("pool.stats", { pool: z.string() }),
  v("pool.trim", { pool: z.string() }),
  v("pool.grow", { pool: z.string(), addBytes: u53 }),
  // Provisional: backups.
  v("backup.run", { backupId: z.string(), resourceId: wireId, repositoryRef: z.string() }),
  v("backup.restore", {
    backupId: z.string(),
    resourceId: wireId,
    repositoryRef: z.string(),
    snapshot: z.string(),
  }),
  v("backup.status", { backupId: z.string() }),
  // Provisional: interactive.
  v("db.connect", { attemptId: wireId, port: u16, ...stream }),
  v("host.shell", { ...stream }),
  // Provisional: platform reconcilers.
  v("firewall.apply", { generation: u53, policy: opaqueDocument }),
  v("firewall.cscli", { argv: z.array(z.string()) }),
  v("proxy.apply", { generation: u53, routes: opaqueDocument }),
  v("proxy.status", {}),
  v("platform.update", { manifest: signedEnvelope }),
]);
export type Command = z.infer<typeof command>;

export const sideEffects = z.enum(["none", "possible"]);

interface OperationRecordShape {
  opId: string;
  verb: z.infer<typeof verb>;
  payloadHash: string;
  claimedAtUnixMs: number;
  outcome: OpOutcome;
}

type CommandResultShape =
  | { kind: "done" }
  | { kind: "applied"; grantId: string; attemptId: string }
  | { kind: "stopped"; certificate: z.infer<typeof signedEnvelope> }
  | { kind: "stop-unresolved"; grantId: string; reasons: string[] }
  | { kind: "slots"; slots: z.infer<typeof slotReport>[] }
  | { kind: "operation"; record: OperationRecordShape }
  | { kind: "stream-opened"; streamId: number }
  | { kind: "adoption-released"; grantId: string; container: string }
  | { kind: "retired"; mutationCount: number }
  | { kind: "document"; schema: string; body: unknown };

export type OpOutcome =
  | { status: "accepted" }
  | { status: "completed"; result: CommandResultShape }
  | {
      status: "failed";
      code: string;
      message: string;
      sideEffects: z.infer<typeof sideEffects>;
    }
  | { status: "unknown"; reason: string }
  | { status: "conflict"; recordedPayloadHash: string }
  | { status: "rejected"; error: z.infer<typeof capabilityError> };

export const operationRecord: z.ZodType<OperationRecordShape> = z.lazy(() =>
  z.strictObject({
    opId: wireId,
    verb,
    payloadHash: sha256Hex,
    claimedAtUnixMs: u53,
    outcome: opOutcome,
  }),
);

export const commandResult: z.ZodType<CommandResultShape> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("done") }),
    z.strictObject({ kind: z.literal("applied"), grantId: wireId, attemptId: wireId }),
    z.strictObject({ kind: z.literal("stopped"), certificate: signedEnvelope }),
    z.strictObject({
      kind: z.literal("stop-unresolved"),
      grantId: wireId,
      reasons: z.array(z.string()),
    }),
    z.strictObject({ kind: z.literal("slots"), slots: z.array(slotReport) }),
    z.strictObject({ kind: z.literal("operation"), record: operationRecord }),
    z.strictObject({ kind: z.literal("stream-opened"), streamId: u32 }),
    z.strictObject({
      kind: z.literal("adoption-released"),
      grantId: wireId,
      container: wireId,
    }),
    z.strictObject({ kind: z.literal("retired"), mutationCount: u32 }),
    z.strictObject({ kind: z.literal("document"), schema: z.string(), body: z.unknown() }),
  ]),
);

export const opOutcome: z.ZodType<OpOutcome> = z.lazy(() =>
  z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("accepted") }),
    z.strictObject({ status: z.literal("completed"), result: commandResult }),
    z.strictObject({
      status: z.literal("failed"),
      code: z.string(),
      message: z.string(),
      sideEffects,
    }),
    z.strictObject({ status: z.literal("unknown"), reason: z.string() }),
    z.strictObject({ status: z.literal("conflict"), recordedPayloadHash: sha256Hex }),
    z.strictObject({ status: z.literal("rejected"), error: capabilityError }),
  ]),
);

/**
 * Serialize a command once for a `request` frame: the exact text goes in
 * `payload`, and its SHA-256 goes in the capability's `payloadHash`.
 */
export function encodeCommand(cmd: Command): { payload: string; payloadHash: string } {
  const payload = JSON.stringify(cmd);
  return { payload, payloadHash: sha256HexOf(new TextEncoder().encode(payload)) };
}
