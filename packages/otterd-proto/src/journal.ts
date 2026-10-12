/**
 * Node journal records (MODEL §2.2.1, §2.6.1, §2.7); mirror of `journal.rs`.
 * The control plane never reads a live journal; it parses exports for
 * recovery inventory. Records are strict: an unknown field is a newer journal.
 */
import { z } from "zod";

import { verb } from "./capability";
import { opOutcome } from "./command";
import { signedEnvelope } from "./envelope";
import { hostBinding, trustedKey } from "./identity";
import { barrierEvidence, engineVerb, slotGrant } from "./lifecycle";
import { keyId, publicKey, sha256Hex, slotRef, u16, u32, u53, wireId } from "./primitives";

export const FRAME_HEADER_LEN = 8;
export const MAX_ENTRY_BYTES = 1024 * 1024;

const mutationRecord = z.strictObject({
  mutationId: wireId,
  class: z.enum(["tenant", "system", "platform"]),
  slot: slotRef,
  grantId: wireId.optional(),
  attemptId: wireId,
  verb: engineVerb,
  objectName: z.string(),
  container: wireId.optional(),
  payloadHash: sha256Hex,
});

const engineOutcome = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("created"), container: wireId }),
  z.strictObject({ kind: z.literal("started") }),
  z.strictObject({ kind: z.literal("already-started") }),
  z.strictObject({ kind: z.literal("restarted") }),
  z.strictObject({ kind: z.literal("stopped") }),
  z.strictObject({ kind: z.literal("already-stopped") }),
  z.strictObject({ kind: z.literal("removed") }),
  z.strictObject({ kind: z.literal("absent") }),
  z.strictObject({ kind: z.literal("refused"), status: u16, message: z.string() }),
]);

const retirement = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("not-submitted") }),
  z.strictObject({ kind: z.literal("external-barrier"), evidence: barrierEvidence }),
  z.strictObject({
    kind: z.literal("host-reboot"),
    submittedBootId: wireId,
    observedBootId: wireId,
    profile: z.string(),
  }),
]);

const r = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) =>
  z.strictObject({ type: z.literal(type), ...shape });

export const UPDATE_PHASES = [
  "staged",
  "cp-quiesced",
  "cp-stopped",
  "schema-boundary",
  "new-cp-started",
  "committed",
  "rolled-back",
] as const;

export const journalRecord = z.discriminatedUnion("type", [
  r("format", { journalFormat: u16, otterdVersion: z.string() }),
  r("identity", {
    installId: wireId,
    nodeId: wireId,
    nodeEpoch: u53,
    keyEpoch: u53,
    identityKeyId: keyId,
    cpKeys: z.array(trustedKey),
    recoveryKey: publicKey,
    host: hostBinding,
  }),
  r("keysRotated", { keyEpoch: u53, identityKeyId: keyId }),
  r("cpKeysChanged", { cpKeys: z.array(trustedKey) }),
  r("processStarted", { incarnation: wireId, bootId: wireId }),
  r("authorityRevoked", { belowTerm: u53, revocationDigest: sha256Hex, reason: z.string() }),
  r("opClaimed", {
    opId: wireId,
    verb,
    payloadHash: sha256Hex,
    capabilityDigest: sha256Hex,
    sessionId: wireId,
    operationEpoch: u53,
    resourceId: wireId.optional(),
  }),
  r("opCompleted", { opId: wireId, outcome: opOutcome }),
  r("grantAccepted", { grant: slotGrant, specDigest: sha256Hex, opId: wireId }),
  r("grantRevoked", { grantId: wireId, reason: z.string() }),
  r("attemptBegun", {
    grantId: wireId,
    attemptId: wireId,
    ordinal: u32,
    reason: z.enum(["initial", "restart", "manual"]),
  }),
  r("mutationIntent", { mutation: mutationRecord }),
  r("mutationSubmitted", {
    mutationId: wireId,
    bootId: wireId,
    incarnation: wireId,
    engineIncarnation: z.string(),
  }),
  r("mutationSettled", { mutationId: wireId, outcome: engineOutcome }),
  r("mutationRetired", { mutationId: wireId, retirement }),
  r("stopCertified", { grantId: wireId, certificate: signedEnvelope }),
  r("quarantineCleared", { slot: slotRef, grantId: wireId, incarnation: wireId }),
  r("holdIntent", {
    hold: z.strictObject({
      holdId: wireId,
      dataIdentity: wireId,
      claimEpoch: u53,
      sourcePath: z.string(),
      stagingPath: z.string(),
      slot: slotRef,
      attemptId: wireId,
    }),
  }),
  r("holdStaged", {
    holdId: wireId,
    backing: z.strictObject({ dev: u53, ino: u53, mntId: u53 }),
    stagingMntId: u53,
  }),
  r("holdUnknown", { holdId: wireId, reason: z.string() }),
  r("holdReleased", { holdId: wireId, reason: z.string() }),
  r("manifestActivated", {
    manifestDigest: sha256Hex,
    manifestRevision: u53,
    bootstrapEpoch: u53,
    authorityTerm: u53,
  }),
  r("updatePhaseEntered", {
    updateId: wireId,
    phase: z.enum(UPDATE_PHASES),
    fromManifestDigest: sha256Hex,
    toManifestDigest: sha256Hex,
  }),
  r("highWater", {
    kind: z.enum([
      "slot-generation",
      "operation-epoch",
      "serving-revision",
      "membership-epoch",
      "publisher-seq",
      "sample-seq",
      "slot-report-seq",
    ]),
    scope: z.string(),
    value: u53,
  }),
  r("compacted", { throughSeq: u53, droppedRecords: u53, priorDigest: sha256Hex }),
]);

export const journalEntry = z.strictObject({ seq: u53, atUnixMs: u53, record: journalRecord });
export type JournalEntry = z.infer<typeof journalEntry>;
