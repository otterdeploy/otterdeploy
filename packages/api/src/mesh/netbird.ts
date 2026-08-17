/**
 * NetBird Management API client.
 *
 * Works identically against the hosted service (https://api.netbird.io) and a
 * self-hosted management server: the base URL is the ONLY difference, which
 * is why "BYO hosted" and "BYO self-hosted" are one provider rather than two.
 *
 * Two details that are easy to get wrong and expensive to debug:
 *   - the auth header is `Authorization: Token <PAT>`, NOT `Bearer`;
 *   - setup keys must set `allow_extra_dns_labels`, or the management server
 *     rejects the wildcard DNS label at peer registration and every private
 *     hostname silently fails to resolve.
 *
 * Design: docs/designs/vpn-mesh.md
 */

import * as z from "zod";

import type {
  AccessPolicySpec,
  MeshEnrolmentKey,
  MeshGroup,
  MeshIdentity,
  MeshPeer,
  MeshProviderClient,
  MintNodeKeyOptions,
} from "./types";

import {
  clampTtl,
  describeFailure,
  ignoreMissing,
  type NetbirdPeer,
  netbirdAccountSchema,
  netbirdGroupSchema,
  netbirdPeerSchema,
  netbirdPolicySchema,
  netbirdSetupKeySchema,
  resolvePeerDomain,
  toMeshGroup,
} from "./netbird-wire";
import { MeshProviderError } from "./types";

// The wire shapes and the pure translations off them live in ./netbird-wire;
// re-exported here because ../netbird has always been their import path.
export { clampTtl, resolvePeerDomain } from "./netbird-wire";

/** Hosted NetBird. A self-hosted management server supplies its own base. */
export const NETBIRD_HOSTED_URL = "https://api.netbird.io";

const REQUEST_TIMEOUT_MS = 15_000;

export interface NetbirdClientOptions {
  /** Management API base, e.g. https://api.netbird.io or a self-hosted URL. */
  managementUrl: string;
  /** Personal access token (plaintext, decrypt at the call site). */
  token: string;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

/** Strip a trailing slash and any trailing `/api` so callers may paste either
 *  `https://netbird.example.com` or `https://netbird.example.com/api`. */
export function normalizeManagementUrl(raw: string): string {
  return raw
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api$/i, "");
}

export class NetbirdClient implements MeshProviderClient {
  readonly kind = "netbird" as const;

  private readonly base: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: NetbirdClientOptions) {
    this.base = normalizeManagementUrl(options.managementUrl);
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Reachability/shape failures share one channel: status null = not HTTP. */
  private fail(message: string): MeshProviderError {
    return new MeshProviderError({ provider: "netbird", status: null, message });
  }

  /** HTTP round-trip + JSON decode, no shape claims. `undefined` = no body
   *  (204, or the empty 200 DELETE sends). Validation happens in {@link request}. */
  private async requestRaw(
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<unknown> {
    const url = `${this.base}/api${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: init?.method ?? "GET",
        headers: {
          // NetBird PATs use the `Token` scheme. `Bearer` is only for IdP JWTs.
          Authorization: `Token ${this.token}`,
          Accept: "application/json",
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
        },
        body: init?.body ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      // Never reached the provider. A reachability problem, NOT a credential
      // problem. Reporting this as "invalid token" sends operators chasing the
      // wrong thing, so `status` stays null and the message says what happened.
      const reason = err instanceof Error ? err.message : String(err);
      throw new MeshProviderError({
        provider: "netbird",
        status: null,
        message:
          controller.signal.aborted && err instanceof Error && err.name === "AbortError"
            ? `NetBird management server at ${this.base} did not respond within ${REQUEST_TIMEOUT_MS / 1000}s.`
            : `Could not reach the NetBird management server at ${this.base}: ${reason}`,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new MeshProviderError({
        provider: "netbird",
        status: response.status,
        message: await describeFailure(response, this.base),
      });
    }
    // DELETE returns 200 with an empty body.
    if (response.status === 204) return undefined;
    const text = await response.text();
    if (!text) return undefined;
    const decoded: unknown = JSON.parse(text);
    return decoded;
  }

  /** {@link requestRaw} + boundary parse. `undefined` = no body; a body that
   *  fails validation surfaces as a MeshProviderError like every other failure. */
  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    init?: { method?: string; body?: unknown },
  ): Promise<T | undefined> {
    const decoded = await this.requestRaw(path, init);
    if (decoded === undefined) return undefined;
    const parsed = schema.safeParse(decoded);
    if (!parsed.success) {
      throw this.fail(
        `The NetBird management server at ${this.base} returned an unexpected response shape for ${path}.`,
      );
    }
    return parsed.data;
  }

  /** A call whose response body (if any) is irrelevant: fire, decode, discard. */
  private async requestVoid(path: string, init?: { method?: string; body?: unknown }) {
    await this.requestRaw(path, init);
  }

  async verify(): Promise<MeshIdentity> {
    const accounts = await this.request("/accounts", z.array(netbirdAccountSchema));
    const account = accounts?.[0];
    if (!account) {
      throw this.fail(
        "The token authenticated but the NetBird API returned no account. Use a token from an account you administer.",
      );
    }

    const peers: NetbirdPeer[] =
      (await this.request("/peers", z.array(netbirdPeerSchema)).catch(() => undefined)) ?? [];
    const { domain, source } = resolvePeerDomain(account, peers);

    return {
      accountId: account.id,
      accountLabel: account.domain ?? null,
      peerDomain: domain,
      peerDomainSource: source,
      peerCount: peers.length,
    };
  }

  async listGroups(): Promise<MeshGroup[]> {
    const groups = await this.request("/groups", z.array(netbirdGroupSchema));
    return (groups ?? []).map(toMeshGroup);
  }

  async ensureGroup(name: string): Promise<MeshGroup> {
    const existing = (await this.listGroups()).find((g) => g.name === name);
    if (existing) return existing;
    const created = await this.request("/groups", netbirdGroupSchema, {
      method: "POST",
      body: { name },
    });
    if (!created) {
      throw this.fail(
        `The NetBird management server at ${this.base} returned an empty response when creating group "${name}".`,
      );
    }
    return toMeshGroup(created);
  }

  async mintNodeKey(options: MintNodeKeyOptions): Promise<MeshEnrolmentKey> {
    const created = await this.request("/setup-keys", netbirdSetupKeySchema, {
      method: "POST",
      body: {
        name: options.name,
        type: "one-off",
        expires_in: clampTtl(options.expiresInSeconds),
        auto_groups: options.groupIds,
        usage_limit: 1,
        ephemeral: options.ephemeral,
        // Without this the management server rejects `--extra-dns-labels` at
        // registration and private hostnames never resolve.
        allow_extra_dns_labels: options.allowExtraDnsLabels,
      },
    });
    if (!created) {
      throw this.fail(
        `The NetBird management server at ${this.base} returned an empty response when minting a setup key.`,
      );
    }
    return {
      id: created.id,
      key: created.key,
      expiresAt: created.expires ? new Date(created.expires) : null,
    };
  }

  async revokeKey(keyId: string): Promise<void> {
    await this.requestVoid(`/setup-keys/${encodeURIComponent(keyId)}`, {
      method: "DELETE",
    }).catch(ignoreMissing);
  }

  async listPeers(): Promise<MeshPeer[]> {
    const peers = await this.request("/peers", z.array(netbirdPeerSchema));
    return (peers ?? []).map((p) => ({
      id: p.id,
      name: p.name ?? p.hostname ?? p.id,
      hostname: p.hostname ?? null,
      ip: p.ip ?? null,
      dnsLabel: p.dns_label ?? null,
      connected: p.connected ?? false,
      lastSeen: p.last_seen ? new Date(p.last_seen) : null,
      groupIds: (p.groups ?? []).map((g) => g.id),
    }));
  }

  async removePeer(peerId: string): Promise<void> {
    await this.requestVoid(`/peers/${encodeURIComponent(peerId)}`, {
      method: "DELETE",
    }).catch(ignoreMissing);
  }

  async ensureAccessPolicy(spec: AccessPolicySpec): Promise<void> {
    // NetBird is zero-trust: nothing is reachable until a policy says so. We
    // therefore never widen access implicitly: an empty source set means the
    // operator hasn't chosen who may connect, and the correct outcome is no
    // policy at all rather than a permissive one.
    if (spec.sourceGroupIds.length === 0 || spec.destinationGroupIds.length === 0) return;

    const body = {
      name: spec.name,
      description: "Managed by otterdeploy: access to private services",
      enabled: true,
      rules: [
        {
          name: spec.name,
          description: "Managed by otterdeploy",
          enabled: true,
          action: "accept",
          bidirectional: false,
          protocol: "tcp",
          ports: spec.ports,
          sources: spec.sourceGroupIds,
          destinations: spec.destinationGroupIds,
        },
      ],
    };

    const policies = await this.request("/policies", z.array(netbirdPolicySchema));
    const existing = (policies ?? []).find((p) => p.name === spec.name);
    if (existing) {
      await this.requestVoid(`/policies/${encodeURIComponent(existing.id)}`, {
        method: "PUT",
        body,
      });
      return;
    }
    await this.requestVoid("/policies", { method: "POST", body });
  }
}
