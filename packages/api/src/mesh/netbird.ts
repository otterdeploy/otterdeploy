/**
 * NetBird Management API client.
 *
 * Works identically against the hosted service (https://api.netbird.io) and a
 * self-hosted management server — the base URL is the ONLY difference, which
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

import type {
  AccessPolicySpec,
  MeshEnrolmentKey,
  MeshGroup,
  MeshIdentity,
  MeshPeer,
  MeshProviderClient,
  MintNodeKeyOptions,
} from "./types";

import { MeshProviderError } from "./types";

/** Hosted NetBird. A self-hosted management server supplies its own base. */
export const NETBIRD_HOSTED_URL = "https://api.netbird.io";

/**
 * Peer DNS zone assumed only when the account exposes no `dns_domain` AND has
 * no peer to read one off. Hosted NetBird's default; self-hosted deployments
 * frequently differ, which is exactly why this is a last resort and why the
 * resolved value carries a `peerDomainSource` the UI can show.
 */
const DEFAULT_PEER_DOMAIN = "netbird.cloud";

/** NetBird's own floor/ceiling for `expires_in` (seconds). */
const MIN_KEY_TTL = 86_400;
const MAX_KEY_TTL = 31_536_000;

const REQUEST_TIMEOUT_MS = 15_000;

interface NetbirdAccount {
  id: string;
  domain?: string | null;
  settings?: { dns_domain?: string | null } | null;
}

interface NetbirdGroup {
  id: string;
  name: string;
  peers_count?: number | null;
}

interface NetbirdSetupKey {
  id: string;
  key: string;
  expires?: string | null;
}

interface NetbirdPeer {
  id: string;
  name?: string | null;
  hostname?: string | null;
  ip?: string | null;
  dns_label?: string | null;
  connected?: boolean | null;
  last_seen?: string | null;
  groups?: { id: string }[] | null;
}

interface NetbirdPolicy {
  id: string;
  name: string;
}

export interface NetbirdClientOptions {
  /** Management API base, e.g. https://api.netbird.io or a self-hosted URL. */
  managementUrl: string;
  /** Personal access token (plaintext — decrypt at the call site). */
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

  private async request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const url = `${this.base}/api${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: init?.method ?? "GET",
        headers: {
          // NetBird PATs use the `Token` scheme — `Bearer` is only for IdP JWTs.
          Authorization: `Token ${this.token}`,
          Accept: "application/json",
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
        },
        body: init?.body ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      // Never reached the provider — a reachability problem, NOT a credential
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
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  async verify(): Promise<MeshIdentity> {
    const accounts = await this.request<NetbirdAccount[]>("/accounts");
    const account = accounts?.[0];
    if (!account) {
      throw new MeshProviderError({
        provider: "netbird",
        status: null,
        message:
          "The token authenticated but the NetBird API returned no account. Use a token from an account you administer.",
      });
    }

    const peers = await this.request<NetbirdPeer[]>("/peers").catch(() => [] as NetbirdPeer[]);
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
    const groups = await this.request<NetbirdGroup[]>("/groups");
    return (groups ?? []).map(toMeshGroup);
  }

  async ensureGroup(name: string): Promise<MeshGroup> {
    const existing = (await this.listGroups()).find((g) => g.name === name);
    if (existing) return existing;
    const created = await this.request<NetbirdGroup>("/groups", {
      method: "POST",
      body: { name },
    });
    return toMeshGroup(created);
  }

  async mintNodeKey(options: MintNodeKeyOptions): Promise<MeshEnrolmentKey> {
    const created = await this.request<NetbirdSetupKey>("/setup-keys", {
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
    return {
      id: created.id,
      key: created.key,
      expiresAt: created.expires ? new Date(created.expires) : null,
    };
  }

  async revokeKey(keyId: string): Promise<void> {
    await this.request<void>(`/setup-keys/${encodeURIComponent(keyId)}`, {
      method: "DELETE",
    }).catch(ignoreMissing);
  }

  async listPeers(): Promise<MeshPeer[]> {
    const peers = await this.request<NetbirdPeer[]>("/peers");
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
    await this.request<void>(`/peers/${encodeURIComponent(peerId)}`, {
      method: "DELETE",
    }).catch(ignoreMissing);
  }

  async ensureAccessPolicy(spec: AccessPolicySpec): Promise<void> {
    // NetBird is zero-trust: nothing is reachable until a policy says so. We
    // therefore never widen access implicitly — an empty source set means the
    // operator hasn't chosen who may connect, and the correct outcome is no
    // policy at all rather than a permissive one.
    if (spec.sourceGroupIds.length === 0 || spec.destinationGroupIds.length === 0) return;

    const body = {
      name: spec.name,
      description: "Managed by otterdeploy — access to private services",
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

    const policies = await this.request<NetbirdPolicy[]>("/policies");
    const existing = (policies ?? []).find((p) => p.name === spec.name);
    if (existing) {
      await this.request<void>(`/policies/${encodeURIComponent(existing.id)}`, {
        method: "PUT",
        body,
      });
      return;
    }
    await this.request<void>("/policies", { method: "POST", body });
  }
}

function toMeshGroup(group: NetbirdGroup): MeshGroup {
  return { id: group.id, name: group.name, peerCount: group.peers_count ?? 0 };
}

/**
 * Resolve the account's peer DNS zone, preferring hard evidence over guesses:
 *
 *   1. `settings.dns_domain` — the account's own configured zone.
 *   2. the suffix of any existing peer's fully-qualified `dns_label` — actual
 *      observed behaviour, which beats any assumption.
 *   3. the hosted default, flagged as such so the UI can say it's a guess.
 */
export function resolvePeerDomain(
  account: NetbirdAccount,
  peers: NetbirdPeer[],
): { domain: string; source: MeshIdentity["peerDomainSource"] } {
  const configured = account.settings?.dns_domain?.trim();
  if (configured) return { domain: stripLeadingDot(configured), source: "account-settings" };

  for (const peer of peers) {
    const label = peer.dns_label?.trim();
    // dns_label is fully-qualified ("host.netbird.cloud") — everything after
    // the first dot is the zone.
    const dot = label?.indexOf(".") ?? -1;
    if (label && dot > 0 && dot < label.length - 1) {
      return { domain: label.slice(dot + 1), source: "peer-dns-label" };
    }
  }

  return { domain: DEFAULT_PEER_DOMAIN, source: "default" };
}

function stripLeadingDot(value: string): string {
  return value.replace(/^\.+/, "");
}

export function clampTtl(seconds: number | undefined): number {
  if (seconds == null) return MIN_KEY_TTL;
  return Math.min(MAX_KEY_TTL, Math.max(MIN_KEY_TTL, Math.floor(seconds)));
}

/** A 404 on delete means the object is already gone — the desired end state. */
function ignoreMissing(err: unknown): void {
  if (err instanceof MeshProviderError && err.status === 404) return;
  throw err;
}

/** Turn a failed response into a message that tells the operator what to fix. */
async function describeFailure(response: Response, base: string): Promise<string> {
  const body = await response.text().catch(() => "");
  let detail = body.slice(0, 300);
  try {
    const parsed = JSON.parse(body) as { message?: string };
    if (parsed?.message) detail = parsed.message;
  } catch {
    // Non-JSON body (an HTML error page from a reverse proxy, typically) —
    // the truncated raw text is more useful than pretending we parsed it.
  }

  switch (response.status) {
    case 401:
      return "NetBird rejected the token (401). Check the personal access token hasn't expired or been revoked.";
    case 403:
      return "The NetBird token authenticated but lacks permission (403). Use a token from an account admin.";
    case 404:
      return `NetBird returned 404 for ${base}/api — check the management URL points at a NetBird management server.`;
    default:
      return `NetBird API error ${response.status}${detail ? `: ${detail}` : ""}`;
  }
}
