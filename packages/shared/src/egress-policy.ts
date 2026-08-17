/**
 * Outbound egress policy for tenant-controlled URLs: webhook delivery,
 * notification channels (Slack/Discord/generic webhook), registry probes,
 * self-hosted git provider calls, and anything else where a tenant supplies
 * a destination the control plane then makes a real HTTP request to.
 *
 * One choke point so every call site gets the same SSRF defenses:
 *
 *   - scheme allow-list: only http/https ever; https by default, http only
 *     when the CALLER (not the tenant) opts in per use case
 *   - denies loopback, link-local (incl. the 169.254.169.254 cloud metadata
 *     address), RFC1918 + CGNAT private ranges, IPv6 unique-local (fc00::/7),
 *     IPv4-mapped IPv6, multicast, and other reserved ranges by default
 *   - resolves the hostname and checks EVERY answer, not just the first.
 *     A mixed public/private DNS answer fails closed
 *   - pins the validated address for the actual TCP connection (a fixed
 *     `lookup` wired into node's http/https `request`) so the record can't
 *     change between the check and the connect (DNS rebinding / TOCTOU).
 *     The socket always dials the address this module validated, while the
 *     Host header / TLS SNI still carry the original hostname
 *   - every redirect hop is re-validated against the same policy (scheme,
 *     host, resolved address), up to a redirect cap; a downgrade from https
 *     to http on redirect is rejected
 *   - a hard wall-clock deadline covers DNS + every hop + body read, and the
 *     response body is capped, so a slow or huge upstream can't wedge a
 *     worker
 *
 * Operators can carve out specific private targets (homelab/LAN services)
 * via `allowAddresses` (IPs or CIDRs): callers thread this through from
 * `OTTERDEPLOY_EGRESS_ALLOWLIST` (packages/env). Nothing is allowed by
 * default: the policy is safe-by-default, opt-in only, and the operator
 * allowlist can never override `denyAddresses` (the control plane's own
 * identity: see each caller's `denyAddresses` wiring).
 *
 * Node-only (uses `node:dns` / `node:http` / `node:https` / `node:net`).
 * Import this module only from server code (packages/api, packages/jobs).
 * It is published as its own subpath export so bundling
 * `@otterdeploy/shared/*` elsewhere (e.g. the web app) never pulls it in.
 */
import type { LookupAddress } from "node:dns";
import type { IncomingHttpHeaders } from "node:http";
import type { LookupFunction } from "node:net";

import { lookup as systemDnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";

export class EgressPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EgressPolicyError";
  }
}

// ─── Denied address ranges (safe-by-default) ───────────────────────────────

const DENY_V4: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // RFC1918
  ["100.64.0.0", 10], // CGNAT / shared address space
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, incl. cloud metadata 169.254.169.254
  ["172.16.0.0", 12], // RFC1918: covers docker's default bridge (172.17/16) and most custom docker networks
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1 (documentation)
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // RFC1918
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2 (documentation)
  ["203.0.113.0", 24], // TEST-NET-3 (documentation)
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved / future use
];

const DENY_V6: ReadonlyArray<readonly [string, number]> = [
  ["::", 128], // unspecified address
  ["::", 96], // deprecated IPv4-compatible IPv6
  ["::1", 128], // loopback
  ["64:ff9b::", 96], // NAT64
  ["100::", 64], // discard-only
  ["2001::", 23], // IETF protocol assignments (incl. Teredo)
  ["2001:2::", 48], // benchmarking
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4
  ["3fff::", 20], // documentation (RFC 9637)
  ["fc00::", 7], // unique local (ULA): the docker/swarm overlay network range
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
];

function buildDenyList(
  ranges: ReadonlyArray<readonly [string, number]>,
  family: "ipv4" | "ipv6",
): BlockList {
  const list = new BlockList();
  for (const [network, prefix] of ranges) list.addSubnet(network, prefix, family);
  return list;
}

const DENY_LIST_V4 = buildDenyList(DENY_V4, "ipv4");
const DENY_LIST_V6 = buildDenyList(DENY_V6, "ipv6");

/** Parses an operator-supplied allowlist (`OTTERDEPLOY_EGRESS_ALLOWLIST`) of
 *  bare IPs and/or CIDRs into a BlockList. Garbage entries (hostnames,
 *  malformed CIDRs) are silently skipped. An allowlist typo must never turn
 *  into an implicit deny-all or a parse-time crash of an outbound call. */
function parseAllowlist(entries: Iterable<string>): BlockList {
  const list = new BlockList();
  for (const raw of entries) {
    const entry = raw.trim();
    if (!entry) continue;
    const slash = entry.indexOf("/");
    const address = slash === -1 ? entry : entry.slice(0, slash);
    const family = isIP(address);
    if (family === 0) continue;
    const type = family === 4 ? "ipv4" : "ipv6";
    if (slash === -1) {
      list.addAddress(address, type);
      continue;
    }
    const prefix = Number(entry.slice(slash + 1));
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > (family === 4 ? 32 : 128)) continue;
    list.addSubnet(address, prefix, type);
  }
  return list;
}

export interface AddressPolicy {
  /** Addresses that are ALWAYS denied, regardless of `allowAddresses`. The
   *  control plane's own identity (its configured origins' resolved IP,
   *  its detected public IP, ...). */
  denyAddresses?: Iterable<string>;
  /** Operator-approved carve-outs (bare IPs or CIDRs) into the default
   *  private-range denial, for homelab/LAN targets. Never overrides
   *  `denyAddresses`. */
  allowAddresses?: Iterable<string>;
}

/** True when `address` (a literal IPv4/IPv6 string, never a hostname) must
 *  not be connected to. Fails closed: anything that isn't a parseable IP
 *  literal is forbidden. */
export function isForbiddenEgressAddress(address: string, policy: AddressPolicy = {}): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  const type = family === 4 ? "ipv4" : "ipv6";

  // The control plane's own identity always wins. An operator allowlist
  // carve-out can open a LAN target, never the control plane's own admin
  // surface.
  if (policy.denyAddresses) {
    const deny = new BlockList();
    let any = false;
    for (const raw of policy.denyAddresses) {
      const f = isIP(raw);
      if (f === 0) continue;
      any = true;
      deny.addAddress(raw, f === 4 ? "ipv4" : "ipv6");
    }
    if (any && deny.check(address, type)) return true;
  }

  // IPv4-mapped IPv6 (`::ffff:a.b.c.d`, in either dotted or hex-group form)
  // is always denied outright rather than unwrapped-and-rechecked. It's a
  // classic filter-bypass encoding and no legitimate outbound target needs
  // it, mapped-public addresses included.
  if (type === "ipv6" && address.toLowerCase().startsWith("::ffff:")) return true;

  if (policy.allowAddresses && parseAllowlist(policy.allowAddresses).check(address, type)) {
    return false;
  }

  const denyList = type === "ipv4" ? DENY_LIST_V4 : DENY_LIST_V6;
  return denyList.check(address, type);
}

// ─── URL / scheme validation ────────────────────────────────────────────────

export interface UrlPolicy {
  /** Allow `http:` in addition to `https:`. Default false. A call site
   *  opts in explicitly; tenants never choose the scheme policy. */
  allowHttp?: boolean;
  /** Hostnames (compared case-insensitively, trailing dot ignored) that are
   *  always denied: the control plane's own configured origins/FQDN. */
  denyHosts?: Iterable<string>;
}

function normalizedHostname(url: URL): string {
  return url.hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
}

/** Parses + validates scheme/credentials/host. Throws {@link EgressPolicyError}
 *  on any violation. Does NOT resolve or check the address. Call
 *  {@link resolveEgressAddresses} next. */
export function assertAllowedEgressUrl(raw: string | URL, policy: UrlPolicy = {}): URL {
  let url: URL;
  try {
    url = raw instanceof URL ? new URL(raw.toString()) : new URL(raw);
  } catch {
    throw new EgressPolicyError("The URL is invalid.");
  }
  const allowHttp = policy.allowHttp ?? false;
  const schemeOk = url.protocol === "https:" || (allowHttp && url.protocol === "http:");
  if (!schemeOk) {
    throw new EgressPolicyError(
      allowHttp ? "Only HTTP and HTTPS URLs are allowed." : "Only HTTPS URLs are allowed.",
    );
  }
  if (url.username || url.password) {
    throw new EgressPolicyError("Credentials in outbound URLs are not allowed.");
  }
  const hostname = normalizedHostname(url);
  if (!hostname) throw new EgressPolicyError("The URL has no hostname.");
  const denied = new Set(
    [...(policy.denyHosts ?? [])].map((host) => host.replace(/\.$/, "").toLowerCase()),
  );
  if (denied.has(hostname)) {
    throw new EgressPolicyError("The URL targets the control plane.");
  }
  return url;
}

// ─── DNS resolution ─────────────────────────────────────────────────────────

export type ResolveHost = (hostname: string) => Promise<LookupAddress[]>;

async function defaultResolveHost(hostname: string): Promise<LookupAddress[]> {
  const family = isIP(hostname);
  if (family !== 0) return [{ address: hostname, family }];
  return systemDnsLookup(hostname, { all: true, verbatim: true });
}

/** Resolves every address for `url`'s hostname and rejects the whole lookup
 *  if ANY resolved address is forbidden. A mixed public/private DNS answer
 *  (classic rebinding setup) never gets a "first address is fine" pass. */
export async function resolveEgressAddresses(
  url: URL,
  addressPolicy: AddressPolicy = {},
  resolveHost: ResolveHost = defaultResolveHost,
): Promise<[LookupAddress, ...LookupAddress[]]> {
  const hostname = normalizedHostname(url);
  const addresses = await resolveHost(hostname);
  const [first, ...rest] = addresses;
  if (first === undefined) {
    throw new EgressPolicyError("The hostname resolved to no addresses.");
  }
  if (addresses.some((resolved) => isForbiddenEgressAddress(resolved.address, addressPolicy))) {
    throw new EgressPolicyError("The hostname resolves to a non-public address.");
  }
  return [first, ...rest];
}

// ─── Pinned-address request (defeats DNS rebinding / TOCTOU) ──────────────

export interface EgressRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer | Uint8Array;
}

export interface RawEgressResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

/** The pinned-socket request primitive, injectable so tests can drive
 *  {@link egressFetch}'s full validate → resolve → pin → redirect loop
 *  without opening a real socket. */
export type PinnedRequest = (
  url: URL,
  address: LookupAddress,
  init: EgressRequestInit,
  timeoutMs: number,
  maxBytes: number,
) => Promise<RawEgressResponse>;

/** A `net.LookupFunction` that always answers with the pre-validated
 *  address, no matter what node's own resolver would say right now. This
 *  is the pin that makes the connection immune to the record changing
 *  between validation and connect. */
function fixedLookup(address: LookupAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (typeof options === "object" && options.all) {
      callback(null, [address]);
      return;
    }
    callback(null, address.address, address.family);
  };
}

function toBuffer(body: EgressRequestInit["body"]): Buffer | undefined {
  if (body === undefined) return undefined;
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === "string") return Buffer.from(body, "utf8");
  return Buffer.from(body);
}

/** Opens the actual socket. Dials `address` directly (via a fixed `lookup`)
 *  while the request line / Host header / TLS SNI still use `url`'s
 *  hostname, exactly like a normal request to that host would. */
function requestPinnedAddress(
  url: URL,
  address: LookupAddress,
  init: EgressRequestInit,
  timeoutMs: number,
  maxBytes: number,
): Promise<RawEgressResponse> {
  return new Promise((resolve, reject) => {
    // A request destroyed mid-connect (the timeout path, below) doesn't
    // reliably re-emit through `error` on every runtime this code targets.
    // Observed on Bun, a `destroy(err)` during the TCP-connect phase (e.g.
    // dialing a routable-but-unreachable private address) fires `close`
    // without ever firing `error`. Track settlement explicitly and treat
    // `close` as a fallback failure rather than trusting `error` alone.
    // Otherwise a single unreachable target can wedge the caller (a BullMQ
    // worker slot, a request handler) indefinitely instead of failing
    // within `timeoutMs` as documented.
    //
    // That fallback MUST be gated on never having seen a response: Bun emits
    // the request's `close` BEFORE the response's `end` (node emits it after),
    // so an ungated `close` handler rejects perfectly good 200s and takes down
    // every outbound call on Bun, GitHub App auth and repo inspect, registry
    // probes, webhook and notification delivery.
    let settled = false;
    let responseStarted = false;
    // Why we destroyed the request, when we destroyed it deliberately. Bun can
    // swallow a `destroy(err)` during connect (firing `close` with no `error`),
    // so the close handler below reports this instead of a generic failure.
    // Otherwise a genuine timeout surfaces as an unexplained connect abort.
    let abortReason: Error | undefined;
    // Deliberately our own timer rather than `req.setTimeout`: this is the
    // documented hard wall-clock deadline for the hop (not an idle-socket
    // timeout), and on Bun the socket-timeout path emits `close` BEFORE it runs
    // the `setTimeout` callback, so only a timer we control is guaranteed to
    // have set `abortReason` before the close handler reads it.
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const settleResolve = (value: RawEgressResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      resolve(value);
    };
    const settleReject = (cause: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      reject(cause instanceof Error ? cause : new EgressPolicyError(String(cause)));
    };

    const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
    const bodyBuf = toBuffer(init.body);
    const req = transport(
      url,
      {
        agent: false,
        method: init.method ?? "GET",
        headers: {
          ...(bodyBuf ? { "content-length": String(bodyBuf.byteLength) } : {}),
          ...init.headers,
        },
        lookup: fixedLookup(address),
      },
      (res) => {
        responseStarted = true;
        const declared = Number(res.headers["content-length"] ?? 0);
        if (Number.isFinite(declared) && declared > maxBytes) {
          res.destroy();
          settleReject(new EgressPolicyError(`Response exceeds ${maxBytes} bytes.`));
          return;
        }
        const chunks: Buffer[] = [];
        let received = 0;
        res.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > maxBytes) {
            res.destroy(new EgressPolicyError(`Response exceeds ${maxBytes} bytes.`));
            return;
          }
          chunks.push(Buffer.from(chunk));
        });
        res.on("end", () => {
          settleResolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
        res.on("error", settleReject);
      },
    );
    deadlineTimer = setTimeout(() => {
      abortReason = new EgressPolicyError("Outbound request timed out.");
      req.destroy(abortReason);
    }, timeoutMs);
    deadlineTimer.unref?.();
    req.on("error", settleReject);
    req.on("close", () => {
      // Response in flight (or already delivered) → this is normal completion
      // on Bun, and `res`'s own `end`/`error` owns the outcome. Only a close
      // with no response at all is the silent connect abort worth failing on.
      if (responseStarted) return;
      settleReject(
        abortReason ?? new EgressPolicyError("Outbound request failed before any response."),
      );
    });
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

function bounded<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new EgressPolicyError("Outbound request timed out.")),
      timeoutMs,
    );
    timer.unref?.();
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (cause) => {
        clearTimeout(timer);
        reject(cause);
      },
    );
  });
}

// ─── Public API: egressFetch ───────────────────────────────────────────────

export interface EgressFetchOptions extends AddressPolicy, UrlPolicy {
  /** Total wall-clock budget for DNS + every redirect hop + body read.
   *  Default 10s. */
  timeoutMs?: number;
  /** Response body cap, checked against `content-length` and the actual
   *  bytes streamed. Default 5 MiB. */
  maxBytes?: number;
  /** Redirect hop cap. Default 5. */
  maxRedirects?: number;
  /** Injectable resolver: tests pin DNS answers without a network call. */
  resolveHost?: ResolveHost;
  /** Injectable pinned-socket request: tests drive the redirect loop
   *  without opening a real socket. Defaults to the real node http/https
   *  implementation. */
  request?: PinnedRequest;
}

export interface EgressResponse {
  status: number;
  ok: boolean;
  /** Final URL after following (and re-validating) any redirects. */
  url: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function toEgressResponse(raw: RawEgressResponse, finalUrl: string): EgressResponse {
  return {
    status: raw.status,
    ok: raw.status >= 200 && raw.status < 300,
    url: finalUrl,
    headers: {
      get(name: string) {
        return headerValue(raw.headers, name.toLowerCase()) ?? null;
      },
    },
    async text() {
      return raw.body.toString("utf8");
    },
    async json(): Promise<unknown> {
      return JSON.parse(raw.body.toString("utf8"));
    },
    async arrayBuffer(): Promise<ArrayBuffer> {
      // Copy the body bytes into a fresh ArrayBuffer (what `buffer.slice`
      // did), which also guarantees a plain ArrayBuffer even if the Buffer
      // were ever backed by a SharedArrayBuffer.
      const copy = new ArrayBuffer(raw.body.byteLength);
      new Uint8Array(copy).set(raw.body);
      return copy;
    },
  };
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

interface RedirectHop {
  url: URL;
  method: string;
  body: EgressRequestInit["body"];
}

/** Re-validates a redirect's `Location` against the same URL policy (scheme,
 *  host) a fresh request would go through, and applies the standard
 *  method/body-demotion rules. Pulled out of {@link egressFetch}'s loop to
 *  keep that function's branching within the repo's complexity budget. */
function resolveRedirectTarget(input: {
  raw: RawEgressResponse;
  current: URL;
  method: string;
  body: EgressRequestInit["body"];
  redirects: number;
  maxRedirects: number;
  urlPolicy: UrlPolicy;
}): RedirectHop {
  const { raw, current, redirects, maxRedirects, urlPolicy } = input;
  if (redirects >= maxRedirects) throw new EgressPolicyError("Too many redirects.");
  const location = headerValue(raw.headers, "location");
  if (!location) throw new EgressPolicyError("Redirect response has no Location.");
  const next = assertAllowedEgressUrl(new URL(location, current), urlPolicy);
  if (current.protocol === "https:" && next.protocol !== "https:") {
    throw new EgressPolicyError("HTTPS redirects may not downgrade to HTTP.");
  }
  // 303 always demotes to GET; 301/302 demote a non-GET to GET (the
  // universally-implemented legacy behavior); 307/308 preserve method +
  // body. A demoted redirect drops the body, never silently replay a
  // signed/authenticated payload to a hop the tenant's original target
  // chose.
  const demote =
    raw.status === 303 || (input.method !== "GET" && raw.status !== 307 && raw.status !== 308);
  return {
    url: next,
    method: demote ? "GET" : input.method,
    body: demote ? undefined : input.body,
  };
}

function remainingBudget(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new EgressPolicyError("Outbound request timed out.");
  return remaining;
}

/**
 * SSRF-safe replacement for `fetch()` on tenant-supplied URLs. Validates
 * scheme + host, resolves and checks every address, pins the connection to
 * the validated address, and re-validates every redirect hop. See the
 * module doc comment for the full threat model.
 *
 * Returns a small `fetch`-`Response`-compatible object (`status`, `ok`,
 * `headers.get()`, `text()`/`json()`/`arrayBuffer()`) so most call sites
 * only need to swap the import.
 */
export async function egressFetch(
  rawUrl: string | URL,
  init: EgressRequestInit = {},
  options: EgressFetchOptions = {},
): Promise<EgressResponse> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
  const maxRedirects = options.maxRedirects ?? 5;
  const resolveHost = options.resolveHost ?? defaultResolveHost;
  const request = options.request ?? requestPinnedAddress;
  const deadline = Date.now() + timeoutMs;

  const urlPolicy: UrlPolicy = { allowHttp: options.allowHttp, denyHosts: options.denyHosts };
  const addressPolicy: AddressPolicy = {
    denyAddresses: options.denyAddresses,
    allowAddresses: options.allowAddresses,
  };

  let url = assertAllowedEgressUrl(rawUrl, urlPolicy);
  let method = init.method ?? "GET";
  let body = init.body;
  const headers = init.headers;

  for (let redirects = 0; ; redirects++) {
    const addresses = await bounded(
      resolveEgressAddresses(url, addressPolicy, resolveHost),
      remainingBudget(deadline),
    );
    const raw = await request(
      url,
      addresses[0],
      { method, headers, body },
      remainingBudget(deadline),
      maxBytes,
    );

    if (!REDIRECT_STATUSES.has(raw.status)) {
      return toEgressResponse(raw, url.toString());
    }
    const hop = resolveRedirectTarget({
      raw,
      current: url,
      method,
      body,
      redirects,
      maxRedirects,
      urlPolicy,
    });
    url = hop.url;
    method = hop.method;
    body = hop.body;
  }
}
