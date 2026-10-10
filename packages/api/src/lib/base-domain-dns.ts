/**
 * DNS for the workspace base domain: checking it and writing it.
 *
 * Every generated host is `<service>-<project>.<base>` (./domains.ts, level 3),
 * so what makes services reachable is ONE wildcard record, `*.<base>`, pointed
 * at this install. The TXT record proves ownership; the wildcard is what
 * traffic actually follows. Both are checked and written here so the settings
 * page, the verify path and Cloudflare one-click all agree on the pair.
 */

import { Result } from "better-result";

import {
  ensureCloudflareDnsRecord,
  upsertCloudflareDnsRecord,
  type CloudflareError,
} from "./cloudflare";
import { VERIFY_TXT_PREFIX, verifyDomainTxt } from "./dns-verify";
import { checkDomainReachability, type DnsState } from "./domain-reachability";

/**
 * The label we resolve to test the wildcard. Any label works under a
 * wildcard, so this one only needs to be unlikely to carry a record of its
 * own, which would answer instead of the wildcard and hide a broken one.
 */
const WILDCARD_PROBE_LABEL = "otterdeploy-dns-check";

export function wildcardProbeName(baseDomain: string): string {
  return `${WILDCARD_PROBE_LABEL}.${baseDomain}`;
}

export function wildcardRecordName(baseDomain: string): string {
  return `*.${baseDomain}`;
}

/**
 * Where the wildcard sends traffic, as the operator needs to hear it.
 *
 *   pointing-here       resolves to this server
 *   pointing-elsewhere  resolves, but to another address (including
 *                       Cloudflare's proxy, flagged by `proxied`)
 *   not-resolving       an authoritative "no such name"
 *   unknown             no resolver answered, or this install's own IP is
 *                       not known, so there is nothing to compare against
 */
export type WildcardDnsState = "pointing-here" | "pointing-elsewhere" | "not-resolving" | "unknown";

export interface WildcardDnsCheck {
  /** The name that was resolved. */
  probe: string;
  state: WildcardDnsState;
  addresses: string[];
  /** Resolves into Cloudflare's edge: the orange cloud is on. */
  proxied: boolean;
  /** The underlying reachability class, for the ACME decision. */
  reachability: DnsState;
}

export async function checkBaseDomainWildcard(input: {
  baseDomain: string;
  serverIp: string | null;
}): Promise<WildcardDnsCheck> {
  const probe = wildcardProbeName(input.baseDomain);
  const reach = await checkDomainReachability({ domain: probe, serverIp: input.serverIp });
  const base = { probe, addresses: reach.addresses, reachability: reach.state };
  switch (reach.state) {
    case "pointed":
      return { ...base, state: "pointing-here", proxied: false };
    case "proxied":
      return { ...base, state: "pointing-elsewhere", proxied: true };
    case "unpointed":
      return {
        ...base,
        state: reach.addresses.length === 0 ? "not-resolving" : "pointing-elsewhere",
        proxied: false,
      };
    case "unknown":
      return { ...base, state: "unknown", proxied: false };
  }
}

export type TxtDnsState = "found" | "wrong-value" | "not-found" | "unknown";

export interface TxtDnsCheck {
  name: string;
  state: TxtDnsState;
  /** Every value the record holds, for "we saw X" diagnostics. */
  found: string[];
}

/** The ownership TXT, read-only. Stamping verification stays with
 *  `verifyBaseDomain`; this only reports what DNS says right now. */
export async function checkBaseDomainTxt(input: {
  baseDomain: string;
  verifyToken: string | null;
}): Promise<TxtDnsCheck> {
  const outcome = await verifyDomainTxt({
    domain: input.baseDomain,
    expectedToken: input.verifyToken,
  });
  const name = `${VERIFY_TXT_PREFIX}.${input.baseDomain}`;
  switch (outcome.reason) {
    case "ok":
      return { name, state: "found", found: outcome.found };
    case "value-mismatch":
      return { name, state: "wrong-value", found: outcome.found };
    case "no-record":
      return { name, state: "not-found", found: [] };
    case "lookup-failed":
    case "missing-token":
      return { name, state: "unknown", found: outcome.found };
  }
}

interface CloudflareTarget {
  token: string;
  zoneId: string;
  baseDomain: string;
  serverIp: string;
}

/**
 * Cloudflare one-click: the TXT, the apex A, and the wildcard A every service
 * hostname resolves through.
 *
 * Upserts, so a second run converges on the same records rather than
 * duplicating them, and a wildcard pointing somewhere else is repointed: the
 * operator pressed the button to make this domain serve from here.
 *
 * The A records are DNS-only. An orange-clouded record terminates TLS at
 * Cloudflare and breaks the HTTP-01 challenge that issues each service's
 * certificate (same reason as routers/service/domains-autoconfigure.ts).
 */
export async function writeBaseDomainRecords(
  input: CloudflareTarget & { verifyToken: string },
): Promise<
  Result<{ txtRecordId: string; aRecordId: string; wildcardRecordId: string }, CloudflareError>
> {
  const zone = { token: input.token, zoneId: input.zoneId };
  // Sequential and fail-fast: a partial write is safe to leave (the next run
  // converges), and pressing on would only pile calls onto a token or zone
  // that has just failed.
  const txt = await upsertCloudflareDnsRecord({
    ...zone,
    type: "TXT",
    name: `${VERIFY_TXT_PREFIX}.${input.baseDomain}`,
    content: input.verifyToken,
  });
  if (txt.isErr()) return Result.err(txt.error);

  const apex = await upsertCloudflareDnsRecord({
    ...zone,
    type: "A",
    name: input.baseDomain,
    content: input.serverIp,
    proxied: false,
  });
  if (apex.isErr()) return Result.err(apex.error);

  const wildcard = await upsertCloudflareDnsRecord({
    ...zone,
    type: "A",
    name: wildcardRecordName(input.baseDomain),
    content: input.serverIp,
    proxied: false,
  });
  if (wildcard.isErr()) return Result.err(wildcard.error);

  return Result.ok({
    txtRecordId: txt.value.id,
    aRecordId: apex.value.id,
    wildcardRecordId: wildcard.value.id,
  });
}

/**
 * Add the wildcard for a workspace that connected Cloudflare before one-click
 * wrote it. Creates it only when the zone has no `*.<base>` A record: this
 * runs on verify and save, where nobody asked to overwrite anything.
 */
export function ensureBaseDomainWildcard(
  input: CloudflareTarget,
): Promise<Result<{ id: string; created: boolean }, CloudflareError>> {
  return ensureCloudflareDnsRecord({
    token: input.token,
    zoneId: input.zoneId,
    type: "A",
    name: wildcardRecordName(input.baseDomain),
    content: input.serverIp,
    proxied: false,
  });
}
