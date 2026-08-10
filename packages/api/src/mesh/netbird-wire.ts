/**
 * NetBird's wire contract: the shapes its Management API actually returns, the
 * pure functions that translate them into our provider-neutral mesh types, and
 * the reading of a failed response into a message an operator can act on.
 *
 * Split out of ./netbird.ts so that file is just the client. Transport, auth
 * header, timeout, and one method per endpoint. Everything here is pure and
 * side-effect free (no fetch, no token), which is what makes the fiddly parts
 * (peer-domain resolution and TTL clamping) cheap to unit-test without a
 * server, and keeps NetBird's snake_case vocabulary from leaking further up.
 */

import type { MeshGroup, MeshIdentity } from "./types";

import { MeshProviderError } from "./types";

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

export interface NetbirdAccount {
  id: string;
  domain?: string | null;
  settings?: { dns_domain?: string | null } | null;
}

export interface NetbirdGroup {
  id: string;
  name: string;
  peers_count?: number | null;
}

export interface NetbirdSetupKey {
  id: string;
  key: string;
  expires?: string | null;
}

export interface NetbirdPeer {
  id: string;
  name?: string | null;
  hostname?: string | null;
  ip?: string | null;
  dns_label?: string | null;
  connected?: boolean | null;
  last_seen?: string | null;
  groups?: { id: string }[] | null;
}

export interface NetbirdPolicy {
  id: string;
  name: string;
}

export function toMeshGroup(group: NetbirdGroup): MeshGroup {
  return { id: group.id, name: group.name, peerCount: group.peers_count ?? 0 };
}

/**
 * Resolve the account's peer DNS zone, preferring hard evidence over guesses:
 *
 *   1. `settings.dns_domain`: the account's own configured zone.
 *   2. the suffix of any existing peer's fully-qualified `dns_label`. Actual
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
    // dns_label is fully-qualified ("host.netbird.cloud"). Everything after
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

/** A 404 on delete means the object is already gone. The desired end state. */
export function ignoreMissing(err: unknown): void {
  if (err instanceof MeshProviderError && err.status === 404) return;
  throw err;
}

/** Turn a failed response into a message that tells the operator what to fix. */
export async function describeFailure(response: Response, base: string): Promise<string> {
  const body = await response.text().catch(() => "");
  let detail = body.slice(0, 300);
  try {
    const parsed = JSON.parse(body) as { message?: string };
    if (parsed?.message) detail = parsed.message;
  } catch {
    // Non-JSON body (an HTML error page from a reverse proxy, typically):
    // the truncated raw text is more useful than pretending we parsed it.
  }

  switch (response.status) {
    case 401:
      return "NetBird rejected the token (401). Check the personal access token hasn't expired or been revoked.";
    case 403:
      return "The NetBird token authenticated but lacks permission (403). Use a token from an account admin.";
    case 404:
      return `NetBird returned 404 for ${base}/api. Check the management URL points at a NetBird management server.`;
    default:
      return `NetBird API error ${response.status}${detail ? `: ${detail}` : ""}`;
  }
}
