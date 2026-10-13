/**
 * Discovery documents: owner snapshots, freshness challenges,
 * serving sets, membership and peer reachability. Mirror of `discovery.rs`.
 */
import * as z from "zod";

import { signedEnvelope } from "./envelope";
import { keyId, nonce, sha256Hex, slotRef, u16, u32, u53, wireId } from "./primitives";
import { portProtocol } from "./spec";

export const MAX_CHUNK_BYTES = 64 * 1024;
export const MAX_FULL_SET_BYTES = 4 * 1024 * 1024;
export const CHALLENGE_WINDOW_MS = 5_000;
export const ELIGIBILITY_TTL_MS = 30_000;
export const MAX_DRAIN_MS = 30_000;

const endpointPort = z.strictObject({ protocol: portProtocol, port: u16 });

export const ownerSnapshot = z.strictObject({
  nodeId: wireId,
  nodeEpoch: u53,
  publisherIncarnation: u53,
  seq: u53,
  membershipEpoch: u53,
  placementRevision: u53,
  fullSetDigest: sha256Hex,
  endpoints: z.array(
    z.strictObject({
      grantId: wireId,
      slot: slotRef,
      generation: u53,
      attemptId: wireId,
      address: z.string(),
      ports: z.array(endpointPort),
      readinessRevision: u53,
      scopeId: wireId,
    }),
  ),
});

const freshnessChallenge = z.strictObject({
  receiverId: wireId,
  receiverBoot: wireId,
  ownerId: wireId,
  nonce,
});

export const challengeAnswer = z.strictObject({
  receiverId: wireId,
  receiverBoot: wireId,
  nonce,
  snapshotDigest: sha256Hex,
  seq: u53,
  ownerEpoch: u53,
});

/** CP-signed exact serving set for one VIP (`otterd/serving-set/v1`). */
export const servingSet = z.strictObject({
  installId: wireId,
  authorityTerm: u53,
  scopeId: wireId,
  vipId: wireId,
  servingRevision: u53,
  operationEpoch: u53,
  newFlowAttempts: z.array(
    z.strictObject({
      grantId: wireId,
      attemptId: wireId,
      nodeEpoch: u53,
      address: z.string(),
      ports: z.array(endpointPort),
    }),
  ),
  withdrawals: z.array(
    z.strictObject({ attemptId: wireId, withdrawalRevision: u53, drainBudgetMs: u53 }),
  ),
});
export type ServingSet = z.infer<typeof servingSet>;

export const membership = z.strictObject({
  installId: wireId,
  authorityTerm: u53,
  membershipEpoch: u53,
  members: z.array(
    z.strictObject({
      nodeId: wireId,
      nodeEpoch: u53,
      identityKeyId: keyId,
      meshAddress: z.string().optional(),
      status: z.enum(["active", "cordoned", "draining", "barred"]),
    }),
  ),
  tombstones: z.array(z.strictObject({ nodeId: wireId, throughEpoch: u53 })),
});

export const peerAnswer = z.strictObject({
  nodeId: wireId,
  bootId: wireId,
  nonce,
  lastObservedCpTerm: u53,
});

export const discoveryMessage = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("challenge"), challenge: freshnessChallenge }),
  z.strictObject({ kind: z.literal("answer"), answer: signedEnvelope }),
  z.strictObject({
    kind: z.literal("chunk"),
    chunk: z.strictObject({
      ownerId: wireId,
      seq: u53,
      snapshotDigest: sha256Hex,
      index: u32,
      count: u32,
      totalBytes: u32,
      data: z.string(),
    }),
  }),
  z.strictObject({
    kind: z.literal("digests"),
    entries: z.array(
      z.strictObject({ ownerId: wireId, ownerEpoch: u53, seq: u53, fullSetDigest: sha256Hex }),
    ),
  }),
  z.strictObject({ kind: z.literal("pull-full-set"), ownerId: wireId }),
  z.strictObject({
    kind: z.literal("peer-challenge"),
    challenge: z.strictObject({ challengerId: wireId, targetId: wireId, nonce }),
  }),
  z.strictObject({ kind: z.literal("peer-answer"), answer: signedEnvelope }),
]);
