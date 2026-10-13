/**
 * Everything the control plane signs with its key: per-request capabilities,
 * lease renewals, the hub's session proof and enrollment certificates. Each
 * document is serialized once and those exact bytes are signed under its own
 * context, so no document can verify as another.
 *
 * A capability is short-lived and bound to one node (audience, node epoch,
 * session), one authority term, one operation (op id, operation epoch,
 * payload hash), one verb's permissions and a fresh nonce.
 */
import {
  type Capability,
  type EnrollCertificate,
  LEASE_DURATION_MS,
  MAX_CAPABILITY_TTL_MS,
  type SessionProof,
  type SignContext,
  type SignedEnvelope,
  type Verb,
  publicKeyFromSeed,
  requiredPermissions,
  signEnvelope,
} from "@otterdeploy/otterd-proto";

/** Default capability lifetime; the node refuses anything over 60 s. */
export const CAPABILITY_TTL_MS = 30_000;
/** Issue slightly in the past: the node's clock bound may trail the control plane's. */
export const NOT_BEFORE_SKEW_MS = 2_000;

export interface Signer {
  /** The control plane's public key (base64), pinned by nodes at enrollment. */
  readonly publicKey: string;
  sign(context: SignContext, document: object): SignedEnvelope;
}

/** A signer over a 32-byte Ed25519 seed held in memory. */
export function seedSigner(seed: Uint8Array): Signer {
  const publicKey = publicKeyFromSeed(seed);
  return {
    publicKey,
    sign: (context, document) =>
      signEnvelope(seed, context, new TextEncoder().encode(JSON.stringify(document))),
  };
}

export function randomNonce(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
}

export interface CapabilityRequest {
  installId: string;
  nodeId: string;
  nodeEpoch: number;
  sessionId: string;
  authorityTerm: number;
  verb: Verb;
  opId: string;
  operationEpoch: number;
  payloadHash: string;
  resourceId?: string;
  binding?: Capability["binding"];
  now: number;
  ttlMs?: number;
}

export function capabilityFor(req: CapabilityRequest): Capability {
  const ttl = Math.min(req.ttlMs ?? CAPABILITY_TTL_MS, MAX_CAPABILITY_TTL_MS - NOT_BEFORE_SKEW_MS);
  const notBefore = req.now - NOT_BEFORE_SKEW_MS;
  return {
    installId: req.installId,
    principal: { kind: "system", id: "scheduler" },
    aud: req.nodeId,
    nodeEpoch: req.nodeEpoch,
    authorityTerm: req.authorityTerm,
    verb: req.verb,
    ...(req.resourceId === undefined ? {} : { resourceId: req.resourceId }),
    ...(req.binding === undefined ? {} : { binding: req.binding }),
    operationEpoch: req.operationEpoch,
    opId: req.opId,
    payloadHash: req.payloadHash,
    nonce: randomNonce(),
    sessionId: req.sessionId,
    notBeforeUnixMs: notBefore,
    expiresAtUnixMs: req.now + ttl,
    permissions: [...requiredPermissions(req.verb)],
  };
}

export function signCapability(signer: Signer, req: CapabilityRequest): SignedEnvelope {
  return signer.sign("otterd/capability/v1", capabilityFor(req));
}

export interface LeaseAnswer {
  installId: string;
  nodeId: string;
  nodeEpoch: number;
  authorityTerm: number;
  bootId: string;
  incarnation: string;
  nonce: string;
  /** Grants still renewed: revoked ones are left out. */
  grants: readonly string[];
}

/** A lease renewal answering one node nonce; validity counts from the node's send instant. */
export function signLease(signer: Signer, a: LeaseAnswer): SignedEnvelope {
  return signer.sign("otterd/lease/v1", {
    ...a,
    grants: [...a.grants],
    durationMs: LEASE_DURATION_MS,
  });
}

/** The hub's session proof for `welcome`. */
export function signHubProof(signer: Signer, proof: Omit<SessionProof, "role">): SignedEnvelope {
  return signer.sign("otterd/session/v1", { role: "hub", ...proof });
}

export function signEnrollCertificate(signer: Signer, cert: EnrollCertificate): SignedEnvelope {
  return signer.sign("otterd/enroll/v1", cert);
}
