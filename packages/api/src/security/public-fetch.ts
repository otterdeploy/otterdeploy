import type { LookupAddress } from "node:dns";

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP, BlockList } from "node:net";
import { networkInterfaces } from "node:os";

import type { PublicFetchResponse, PublicRequest } from "./public-fetch-request";

import { UnsafeOutboundUrlError } from "./public-fetch-error";
import { requestPinnedPublicAddress } from "./public-fetch-request";

export { UnsafeOutboundUrlError } from "./public-fetch-error";

const FORBIDDEN = new BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  FORBIDDEN.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of [
  ["::", 128],
  ["::", 96],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001::", 23],
  ["2001:2::", 48],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  FORBIDDEN.addSubnet(network, prefix, "ipv6");
}

export interface PublicFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  blockedHosts?: Iterable<string>;
  blockedAddresses?: Iterable<string>;
}

export interface PublicFetchDependencies {
  resolve?: (hostname: string) => Promise<LookupAddress[]>;
  request?: PublicRequest;
  localAddresses?: Iterable<string>;
}

function normalizedHostname(url: URL): string {
  return url.hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
}

function localInterfaceAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .map((entry) => entry.address);
}

function addressBlocklist(addresses: Iterable<string>): BlockList {
  const list = new BlockList();
  for (const address of addresses) {
    const family = isIP(address);
    if (family === 4) list.addAddress(address, "ipv4");
    if (family === 6) list.addAddress(address, "ipv6");
  }
  return list;
}

export function isForbiddenOutboundAddress(
  address: string,
  additionallyBlocked: Iterable<string> = [],
): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  if (family === 6 && address.toLowerCase().startsWith("::ffff:")) return true;
  const type = family === 4 ? "ipv4" : "ipv6";
  return (
    FORBIDDEN.check(address, type) || addressBlocklist(additionallyBlocked).check(address, type)
  );
}

export function validatePublicHttpUrl(raw: string | URL, blockedHosts: Iterable<string> = []): URL {
  let url: URL;
  try {
    url = raw instanceof URL ? new URL(raw) : new URL(raw);
  } catch {
    throw new UnsafeOutboundUrlError("The URL is invalid.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeOutboundUrlError("Only HTTP and HTTPS URLs are allowed.");
  }
  if (url.username || url.password) {
    throw new UnsafeOutboundUrlError("Credentials in outbound URLs are not allowed.");
  }
  const hostname = normalizedHostname(url);
  const denied = new Set([...blockedHosts].map((host) => host.replace(/\.$/, "").toLowerCase()));
  if (denied.has(hostname)) {
    throw new UnsafeOutboundUrlError("The URL targets the control plane.");
  }
  return url;
}

async function defaultResolve(hostname: string): Promise<LookupAddress[]> {
  const family = isIP(hostname);
  if (family !== 0) return [{ address: hostname, family }];
  return dnsLookup(hostname, { all: true, verbatim: true });
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function bounded<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new UnsafeOutboundUrlError("Outbound request timed out.")),
      timeoutMs,
    );
    timer.unref();
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

async function resolvePublicAddresses(
  url: URL,
  blockedAddresses: string[],
  resolveHost: (hostname: string) => Promise<LookupAddress[]>,
  deadline: number,
): Promise<[LookupAddress, ...LookupAddress[]]> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new UnsafeOutboundUrlError("Outbound request timed out.");
  const addresses = await bounded(resolveHost(normalizedHostname(url)), remaining);
  if (addresses.length === 0) {
    throw new UnsafeOutboundUrlError("The hostname resolved to no addresses.");
  }
  if (
    addresses.some((resolved) => isForbiddenOutboundAddress(resolved.address, blockedAddresses))
  ) {
    throw new UnsafeOutboundUrlError("The hostname resolves to a non-public address.");
  }
  return addresses as [LookupAddress, ...LookupAddress[]];
}

function redirectTarget(
  response: PublicFetchResponse,
  current: URL,
  blockedHosts: string[],
  redirects: number,
  maxRedirects: number,
): URL | null {
  if (!REDIRECTS.has(response.status)) return null;
  if (redirects >= maxRedirects) throw new UnsafeOutboundUrlError("Too many redirects.");
  const location = response.headers.location;
  if (!location) throw new UnsafeOutboundUrlError("Redirect response has no Location.");
  const next = validatePublicHttpUrl(new URL(location, current), blockedHosts);
  if (current.protocol === "https:" && next.protocol !== "https:") {
    throw new UnsafeOutboundUrlError("HTTPS redirects may not downgrade to HTTP.");
  }
  return next;
}

function responseText(response: PublicFetchResponse): string {
  if (response.status < 200 || response.status >= 300) {
    throw new UnsafeOutboundUrlError(`Remote server returned HTTP ${response.status}.`);
  }
  const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
  const disallowed = ["text/html", "application/json", "xml"];
  if (disallowed.some((value) => contentType.includes(value))) {
    throw new UnsafeOutboundUrlError("Remote response is not a plain-text blocklist.");
  }
  return response.body.toString("utf8");
}

export async function fetchPublicText(
  rawUrl: string,
  options: PublicFetchOptions = {},
  dependencies: PublicFetchDependencies = {},
): Promise<{ text: string; finalUrl: string }> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
  const maxRedirects = options.maxRedirects ?? 5;
  const blockedHosts = [...(options.blockedHosts ?? [])];
  const blockedAddresses = [
    ...(options.blockedAddresses ?? []),
    ...(dependencies.localAddresses ?? localInterfaceAddresses()),
  ];
  const resolveHost = dependencies.resolve ?? defaultResolve;
  const request = dependencies.request ?? requestPinnedPublicAddress;
  const deadline = Date.now() + timeoutMs;
  let url = validatePublicHttpUrl(rawUrl, blockedHosts);

  for (let redirects = 0; ; redirects++) {
    const addresses = await resolvePublicAddresses(url, blockedAddresses, resolveHost, deadline);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new UnsafeOutboundUrlError("Outbound request timed out.");
    const response = await request(url, addresses[0], remaining, maxBytes);
    const next = redirectTarget(response, url, blockedHosts, redirects, maxRedirects);
    if (next) {
      url = next;
      continue;
    }
    return { text: responseText(response), finalUrl: url.toString() };
  }
}
