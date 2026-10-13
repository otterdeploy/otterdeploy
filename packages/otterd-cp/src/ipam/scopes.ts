/**
 * Scope networks on a node and the endpoint addresses inside them.
 */
import { Result } from "better-result";

import type { AddressPlan } from "./state";

import { type Net, formatAddr, formatNet, host, overlaps, size, subnet, subnetCount } from "./addr";
import { type IpamError, ipamError } from "./errors";
import { LARGEST_SCOPE_LEN, UNIT_LEN } from "./layout";
import { hold } from "./quarantine";

/** A /24../27 network for the scope on the node: first fit, aligned. */
export function allocateScope(
  p: AddressPlan,
  scope: string,
  node: string,
  len: number,
): Result<Net, IpamError> {
  if (len < LARGEST_SCOPE_LEN || len > UNIT_LEN) return Result.err(ipamError.scopeSize(len));
  const alloc = p.nodes.get(node);
  if (!alloc) return Result.err(ipamError.unknownNode(node));
  const existing = p.scopes.get(scope)?.get(node);
  if (existing) return Result.err(ipamError.scopeExists(scope, formatNet(existing)));
  const busy = [
    ...[...p.scopes.values()].flatMap((nets) => {
      const n = nets.get(node);
      return n ? [n] : [];
    }),
    ...p.quarantine.flatMap((q) => (q.held.kind === "scopeNetwork" ? [q.held.prefix] : [])),
    ...p.external.map((x) => x.prefix),
  ];
  let prefix: Net | null = null;
  for (let i = 0; i < subnetCount(alloc.slice, len) && !prefix; i++) {
    const c = subnet(alloc.slice, len, i);
    if (c && !busy.some((b) => overlaps(b, c))) prefix = c;
  }
  if (!prefix) return Result.err(ipamError.sliceFull(node, len));
  const nets = p.scopes.get(scope) ?? new Map<string, Net>();
  nets.set(node, prefix);
  p.scopes.set(scope, nets);
  return Result.ok(prefix);
}

/** Releases the scope's network on one node, held until all peers acknowledge. */
export function releaseScope(
  p: AddressPlan,
  scope: string,
  node: string,
  forwardingPeers: ReadonlySet<string>,
): Result<number | null, IpamError> {
  const nets = p.scopes.get(scope);
  const prefix = nets?.get(node);
  if (!nets || !prefix) return Result.err(ipamError.unknownScope(scope, node));
  nets.delete(node);
  if (nets.size === 0) p.scopes.delete(scope);
  p.endpoints.delete(formatNet(prefix));
  return Result.ok(hold(p, { kind: "scopeNetwork", prefix }, forwardingPeers));
}

/**
 * The lowest free endpoint address in the scope's network on the node,
 * skipping the network address, the gateway `.1`, broadcast, and live and
 * held addresses.
 */
export function allocateEndpoint(
  p: AddressPlan,
  scope: string,
  node: string,
): Result<number, IpamError> {
  const network = p.scopes.get(scope)?.get(node);
  if (!network) return Result.err(ipamError.unknownScope(scope, node));
  const key = formatNet(network);
  const held = new Set(
    p.quarantine.flatMap((q) =>
      q.held.kind === "endpoint" && formatNet(q.held.network) === key ? [q.held.addr] : [],
    ),
  );
  const entry = p.endpoints.get(key) ?? { network, live: new Set<number>() };
  p.endpoints.set(key, entry);
  for (let h = 2; h < size(network) - 1; h++) {
    const a = host(network, h);
    if (a !== null && !entry.live.has(a) && !held.has(a)) {
      entry.live.add(a);
      return Result.ok(a);
    }
  }
  return Result.err(ipamError.scopeFull(key));
}

/**
 * Releases an endpoint address, held until every forwarding peer acknowledges
 * conntrack cleanup and observed policy withdrawal.
 */
export function releaseEndpoint(
  p: AddressPlan,
  addr: number,
  forwardingPeers: ReadonlySet<string>,
): Result<number | null, IpamError> {
  const owner = [...p.endpoints.values()].find((e) => e.live.delete(addr));
  if (!owner) return Result.err(ipamError.unknownEndpoint(formatAddr(addr)));
  return Result.ok(hold(p, { kind: "endpoint", network: owner.network, addr }, forwardingPeers));
}
