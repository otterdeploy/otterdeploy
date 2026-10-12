/**
 * Ownership protocol shapes (MODEL §2, §3): grants, process observations,
 * submission states, stop certificates, barrier evidence and leases. Mirror of
 * `lifecycle.rs`.
 */
import { z } from "zod";

import { nonce, sha256Hex, slotRef, u32, u53, i64, wireId } from "./primitives";
import { disconnectAction, restartPolicy } from "./spec";

export const dataClaim = z.strictObject({
  dataIdentity: wireId,
  claimEpoch: u53,
  access: z.enum(["ro", "rw"]),
});

export const slotGrant = z.strictObject({
  grantId: wireId,
  slot: slotRef,
  generation: u53,
  authorityTerm: u53,
  nodeEpoch: u53,
  incarnation: wireId,
  exclusive: z.boolean(),
  disconnectAction,
  restart: restartPolicy,
  dataClaims: z.array(dataClaim),
  probeOnly: z.boolean(),
});
export type SlotGrant = z.infer<typeof slotGrant>;

export const grantState = z.enum([
  "prepared",
  "granted",
  "starting",
  "running",
  "stopping",
  "released",
  "unknown",
]);
export const submissionState = z.enum(["not-submitted", "submitted", "settled", "retired"]);
export const engineVerb = z.enum(["create", "start", "restart", "stop", "kill", "remove"]);

export const processObservation = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("absent") }),
  z.strictObject({ state: z.literal("created") }),
  z.strictObject({ state: z.literal("running"), pid: u32 }),
  z.strictObject({ state: z.literal("exited"), exitCode: i64 }),
  z.strictObject({ state: z.literal("unknown"), reason: z.string() }),
]);
export type ProcessObservation = z.infer<typeof processObservation>;

export const slotReport = z.object({
  slot: slotRef,
  grantId: wireId,
  generation: u53,
  state: grantState,
  quarantined: z.boolean(),
  revoked: z.boolean(),
  attempts: z.array(
    z.object({
      attemptId: wireId,
      ordinal: u32,
      container: wireId.optional(),
      process: processObservation,
      mutations: z.array(
        z.object({ mutationId: wireId, verb: engineVerb, state: submissionState }),
      ),
    }),
  ),
  unknownHolds: z.array(wireId).optional(),
});
export type SlotReport = z.infer<typeof slotReport>;

/** Node-signed (`otterd/stop-certificate/v1`); the CP checks it before releasing a grant. */
export const stopCertificate = z.strictObject({
  installId: wireId,
  nodeId: wireId,
  nodeEpoch: u53,
  slot: slotRef,
  grantId: wireId,
  opId: wireId,
  attemptIds: z.array(wireId),
  containers: z.array(z.strictObject({ container: wireId, process: processObservation })),
  cgroupsEmpty: z.boolean(),
  mutationInventoryDigest: sha256Hex,
  mutationCount: u32,
  bootId: wireId,
  issuedAtUnixMs: u53,
});
export type StopCertificate = z.infer<typeof stopCertificate>;

export const barrierEvidence = z.strictObject({
  evidenceId: wireId,
  method: z.enum(["provider-power-off", "manual-fence"]),
  adapter: z.string(),
  providerActionId: z.string().optional(),
  assertedBy: z.string().optional(),
  nodeEpoch: u53,
  bootId: wireId.optional(),
  observedAtUnixMs: u53,
});

export const leaseRequest = z.object({
  nonce,
  nodeEpoch: u53,
  bootId: wireId,
  incarnation: wireId,
  grants: z.array(wireId),
});

/** CP → node (`otterd/lease/v1`); duration counts from the node's send instant. */
export const leaseRenewal = z.strictObject({
  installId: wireId,
  nodeId: wireId,
  nodeEpoch: u53,
  authorityTerm: u53,
  bootId: wireId,
  incarnation: wireId,
  nonce,
  grants: z.array(wireId),
  durationMs: u53,
});

export const LEASE_RENEW_INTERVAL_MS = 5_000;
export const LEASE_DURATION_MS = 20_000;
