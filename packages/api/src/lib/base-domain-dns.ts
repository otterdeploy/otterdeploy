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
  createCloudflareDnsRecord,
  listCloudflareDnsRecordsByName,
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

/** Where `name` resolves, against this install's address. */
export async function checkPointsHere(input: {
  name: string;
  serverIp: string | null;
}): Promise<WildcardDnsCheck> {
  const reach = await checkDomainReachability({ domain: input.name, serverIp: input.serverIp });
  const base = { probe: input.name, addresses: reach.addresses, reachability: reach.state };
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

export function checkBaseDomainWildcard(input: {
  baseDomain: string;
  serverIp: string | null;
}): Promise<WildcardDnsCheck> {
  return checkPointsHere({ name: wildcardProbeName(input.baseDomain), serverIp: input.serverIp });
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
  /** This install's IPv6, so an AAAA record already pointing here is ours. */
  serverIpv6?: string | null;
}

/**
 * What one-click did with an address record.
 *
 *   created    the name was free, so an A record now points here
 *   present    an A record already points here; left as it is
 *   elsewhere  the name already has an A, AAAA or CNAME record pointing
 *              somewhere else, so nothing was written
 */
export type PointRecordOutcome =
  | { state: "created"; recordId: string }
  | { state: "present"; recordId: string }
  | { state: "elsewhere"; existing: { type: string; content: string } };

const ADDRESS_TYPES = new Set(["A", "AAAA", "CNAME"]);

/**
 * Point `name` here only if nothing else already answers for it.
 *
 * Never overwrites. An existing apex record is usually a live website, and an
 * existing wildcard is a choice the operator made; repointing either from a
 * button labelled "Write DNS records" could take a site down. The check on the
 * settings page shows where such a record points instead.
 */
async function pointHereIfFree(
  target: CloudflareTarget,
  name: string,
): Promise<Result<PointRecordOutcome, CloudflareError>> {
  const listed = await listCloudflareDnsRecordsByName({
    token: target.token,
    zoneId: target.zoneId,
    name,
  });
  if (listed.isErr()) return Result.err(listed.error);
  const address = listed.value.filter((r) => ADDRESS_TYPES.has(r.type));
  const pointsHere = (r: { type: string; content: string }) =>
    (r.type === "A" && r.content === target.serverIp) ||
    (r.type === "AAAA" && target.serverIpv6 != null && r.content === target.serverIpv6);

  const other = address.find((r) => !pointsHere(r));
  if (other) {
    return Result.ok({
      state: "elsewhere",
      existing: { type: other.type, content: other.content },
    });
  }
  const ours = address[0];
  if (ours) return Result.ok({ state: "present", recordId: ours.id });

  const created = await createCloudflareDnsRecord({
    token: target.token,
    zoneId: target.zoneId,
    type: "A",
    name,
    content: target.serverIp,
    // DNS-only: a proxied record terminates TLS at Cloudflare and breaks the
    // HTTP-01 challenge (same reason as routers/service/domains-autoconfigure.ts).
    proxied: false,
  });
  return created.map((r) => ({ state: "created" as const, recordId: r.id }));
}

/**
 * Cloudflare one-click: the verify TXT, the apex, and the wildcard every
 * service hostname (`<service>-<project>.<base>`) resolves through.
 *
 * The TXT is ours (`_otterdeploy-verify`) and is upserted. The two address
 * records are only created where the name is free: see {@link pointHereIfFree}.
 * Services need only the wildcard, so an apex that serves another site is
 * fine and is left alone. Running this twice leaves the zone as it was.
 */
export async function writeBaseDomainRecords(
  input: CloudflareTarget & { verifyToken: string },
): Promise<
  Result<
    { txtRecordId: string; apex: PointRecordOutcome; wildcard: PointRecordOutcome },
    CloudflareError
  >
> {
  // Sequential and fail-fast: a partial write is safe to leave (the next run
  // converges), and pressing on would only pile calls onto a token or zone
  // that has just failed.
  const txt = await upsertCloudflareDnsRecord({
    token: input.token,
    zoneId: input.zoneId,
    type: "TXT",
    name: `${VERIFY_TXT_PREFIX}.${input.baseDomain}`,
    content: input.verifyToken,
  });
  if (txt.isErr()) return Result.err(txt.error);

  const apex = await pointHereIfFree(input, input.baseDomain);
  if (apex.isErr()) return Result.err(apex.error);

  const wildcard = await pointHereIfFree(input, wildcardRecordName(input.baseDomain));
  if (wildcard.isErr()) return Result.err(wildcard.error);

  return Result.ok({ txtRecordId: txt.value.id, apex: apex.value, wildcard: wildcard.value });
}

/**
 * Add the wildcard for a workspace that connected Cloudflare before one-click
 * wrote it. Runs on verify and save; same never-overwrite rule as one-click.
 */
export function ensureBaseDomainWildcard(
  input: CloudflareTarget,
): Promise<Result<PointRecordOutcome, CloudflareError>> {
  return pointHereIfFree(input, wildcardRecordName(input.baseDomain));
}
