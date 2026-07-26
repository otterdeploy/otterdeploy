/**
 * Provider-agnostic private-networking interface.
 *
 * NetBird is the reference implementation (`./netbird.ts`); Tailscale slots in
 * behind the same interface. The two providers differ in exactly one
 * architecturally interesting place — how a private hostname resolves inside
 * the mesh — and that difference is confined to `privateHostFor()` plus the
 * flags the node agent joins with. Everything above this interface (the oRPC
 * router, provisioning, the Caddy reconciler, the UI) is provider-blind.
 *
 * Design: docs/designs/vpn-mesh.md
 */

import { TaggedError } from "better-result";

export type MeshProviderKind = "netbird" | "tailscale";

/** Proof the stored credential works, plus the facts we cache on the row. */
export interface MeshIdentity {
  /** Provider-side account (NetBird) / tailnet (Tailscale) id. */
  accountId: string;
  /** Human-readable account label for the UI (NetBird's `domain`, e.g. the
   *  org's IdP domain). Null when the provider doesn't expose one. */
  accountLabel: string | null;
  /**
   * The DNS zone peers resolve under — "netbird.cloud" by default, but
   * accounts can change it and self-hosted deployments commonly do. Read from
   * the API, never assumed: getting this wrong silently breaks every private
   * hostname we generate.
   */
  peerDomain: string;
  /** How `peerDomain` was determined — surfaced in the UI so an operator can
   *  tell a confirmed zone from a fallback guess. */
  peerDomainSource: "account-settings" | "peer-dns-label" | "default";
  /** Peers currently registered on the account (for the status card). */
  peerCount: number;
}

/** A provider group (NetBird) or tag (Tailscale). */
export interface MeshGroup {
  id: string;
  name: string;
  peerCount: number;
}

/** A short-lived credential a node uses to join the mesh exactly once. */
export interface MeshEnrolmentKey {
  /** Provider-side key id, so we can revoke it if the join never completes. */
  id: string;
  /** The secret the agent joins with. Never persisted. */
  key: string;
  expiresAt: Date | null;
}

export interface MeshPeer {
  id: string;
  name: string;
  hostname: string | null;
  /** Overlay (mesh) IPv4 address. */
  ip: string | null;
  /** Fully-qualified mesh DNS name, e.g. "prod-04.netbird.cloud". */
  dnsLabel: string | null;
  connected: boolean;
  lastSeen: Date | null;
  groupIds: string[];
}

export interface MintNodeKeyOptions {
  /** Label the key carries provider-side, for auditability in their dashboard. */
  name: string;
  /** Groups/tags the joining peer is auto-assigned to. */
  groupIds: string[];
  /**
   * Permit the peer to register extra DNS labels. Required for the wildcard
   * label that gives private services their internal hostnames — the
   * management server REJECTS labels at registration if the key doesn't allow
   * them, so this is not optional for node keys.
   */
  allowExtraDnsLabels: boolean;
  /** Auto-remove the peer when it goes offline for good. */
  ephemeral: boolean;
  expiresInSeconds?: number;
}

/** Who may reach private services, and on what. */
export interface AccessPolicySpec {
  name: string;
  /** Provider group ids allowed to initiate. */
  sourceGroupIds: string[];
  /** Provider group ids holding the otterdeploy nodes. */
  destinationGroupIds: string[];
  /** TCP ports the policy opens (the private edge listener). */
  ports: string[];
}

export interface MeshProviderClient {
  readonly kind: MeshProviderKind;

  /** whoami — proves the credential works and returns the cacheable facts. */
  verify(): Promise<MeshIdentity>;

  listGroups(): Promise<MeshGroup[]>;

  /** Idempotently ensure a group/tag exists, returning its id. */
  ensureGroup(name: string): Promise<MeshGroup>;

  mintNodeKey(options: MintNodeKeyOptions): Promise<MeshEnrolmentKey>;

  /** Best-effort revoke of a key whose join never completed. */
  revokeKey(keyId: string): Promise<void>;

  listPeers(): Promise<MeshPeer[]>;

  /** Teardown when a server is deleted. Idempotent: a peer that's already gone
   *  is success, not an error. */
  removePeer(peerId: string): Promise<void>;

  ensureAccessPolicy(spec: AccessPolicySpec): Promise<void>;
}

/**
 * Any provider-API failure, carrying enough to render an honest message.
 * `status` is the HTTP status when the call reached the provider at all —
 * null means we never got a response (DNS failure, unreachable self-hosted
 * management server, timeout), which is a materially different problem for
 * the operator and must not be reported as "invalid credentials".
 */
export class MeshProviderError extends TaggedError("MeshProviderError")<{
  message: string;
  status: number | null;
  provider: MeshProviderKind;
}>() {
  constructor(args: { message: string; status?: number | null; provider: MeshProviderKind }) {
    super({ message: args.message, status: args.status ?? null, provider: args.provider });
  }

  /** True when the credential itself is the problem (as opposed to reachability
   *  or a provider-side outage) — drives "re-authenticate" vs "retry" in the UI. */
  get isAuthFailure(): boolean {
    return this.status === 401 || this.status === 403;
  }
}
