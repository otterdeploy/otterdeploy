/** Node identity, enrollment and key rotation; mirror of `identity.rs`. */
import * as z from "zod";

import { signedEnvelope } from "./envelope";
import { keyId, nonce, publicKey, u32, u53, wireId } from "./primitives";

export const NODE_ROLES = ["worker", "edge", "build", "registry", "monitor", "platform"] as const;
export const nodeRole = z.enum(NODE_ROLES);
export type NodeRole = z.infer<typeof nodeRole>;

export const providerBinding = z.strictObject({
  provider: z.string(),
  serverId: z.string(),
  createdAt: z.string().optional(),
});

export const hostBinding = z.strictObject({
  machineId: z.string(),
  productUuid: z.string().optional(),
  provider: providerBinding.optional(),
});

/** Static facts, once per connection (lenient: the node may add fields). */
export const hostFacts = z.object({
  hostname: z.string(),
  arch: z.string(),
  osId: z.string(),
  osVersion: z.string(),
  kernel: z.string(),
  cpuCores: u32,
  memoryBytes: u53,
  dockerVersion: z.string().optional(),
  systemdVersion: z.string().optional(),
});

export const nodeKeys = z.strictObject({
  keyEpoch: u53,
  identity: publicKey,
  cacheEncryption: publicKey,
  wireguard: publicKey,
});

/** Node → CP, signed with the new identity key (`otterd/enroll-request/v1`). */
export const enrollRequest = z.strictObject({
  token: z.string(),
  nonce,
  keys: nodeKeys,
  host: hostBinding,
  facts: hostFacts,
  requestedRoles: z.array(nodeRole),
  otterdVersion: z.string(),
});

export const trustedKey = z.strictObject({
  key: publicKey,
  epoch: u53,
  notAfterUnixMs: u53.optional(),
});

export const anchorLocation = z.strictObject({
  endpoint: z.string(),
  bucket: z.string(),
  prefix: z.string(),
  region: z.string(),
});

/** CP → node (`otterd/enroll/v1`); also a re-enrollment with a new epoch. */
export const enrollCertificate = z.strictObject({
  installId: wireId,
  nodeId: wireId,
  nodeEpoch: u53,
  authorityTerm: u53,
  roles: z.array(nodeRole),
  identityKeyId: keyId,
  keyEpoch: u53,
  host: hostBinding,
  cpKeys: z.array(trustedKey),
  recoveryKey: publicKey,
  controlUrl: z.string(),
  anchor: anchorLocation.optional(),
  issuedAtUnixMs: u53,
  reason: z.string(),
});
export type EnrollCertificate = z.infer<typeof enrollCertificate>;

export const keyRotation = z.strictObject({
  installId: wireId,
  nodeId: wireId,
  nodeEpoch: u53,
  fromKeyEpoch: u53,
  newKeys: nodeKeys,
  reason: z.string(),
});

export const crossSigned = z.strictObject({ byOld: signedEnvelope, byNew: signedEnvelope });

export const cpKeyTransition = z.strictObject({
  installId: wireId,
  fromKeyId: keyId,
  to: trustedKey,
  oldValidUntilUnixMs: u53,
});

/** Recovery-root revocation (`otterd/authority-revoke/v1`). */
export const authorityRevocation = z.strictObject({
  installId: wireId,
  belowTerm: u53,
  nodes: z.array(wireId).optional(),
  issuedAtUnixMs: u53,
  reason: z.string(),
});
