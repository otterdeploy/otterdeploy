/**
 * Node slices and mesh ordinals, and the inventory prefixes they avoid.
 */
import { Result } from "better-result";

import type { AddressPlan, NodeAlloc } from "./state";

import { type Net, formatNet, host, overlaps, sameNet, size } from "./addr";
import { type IpamError, ipamError } from "./errors";
import { type MeshGeneration, meshGeneration, meshStable, slices } from "./layout";
import { hold } from "./quarantine";

function heldSlices(p: AddressPlan): { slice: Net; ordinal: number }[] {
  return p.quarantine.flatMap((q) =>
    q.held.kind === "nodeSlice" ? [{ slice: q.held.slice, ordinal: q.held.ordinal }] : [],
  );
}

/**
 * Records an inventory prefix managed ranges must avoid. Refused when it
 * overlaps the VIP or system range or a live or held node slice: the overlap
 * has to be resolved before cross-node routing.
 */
export function reserveExternal(
  p: AddressPlan,
  prefix: Net,
  source: string,
): Result<null, IpamError> {
  const taken = [
    p.layout.vip,
    p.layout.system,
    ...[...p.nodes.values()].map((n) => n.slice),
    ...heldSlices(p).map((h) => h.slice),
  ];
  const clash = taken.find((t) => overlaps(t, prefix));
  if (clash) {
    return Result.err(ipamError.conflict(formatNet(prefix), source, formatNet(clash)));
  }
  if (!p.external.some((x) => sameNet(x.prefix, prefix))) p.external.push({ prefix, source });
  return Result.ok(null);
}

/** Gives a node the lowest free slice and mesh ordinal. */
export function enrollNode(p: AddressPlan, node: string): Result<NodeAlloc, IpamError> {
  const existing = p.nodes.get(node);
  if (existing) return Result.err(ipamError.nodeExists(node, formatNet(existing.slice)));
  const held = heldSlices(p);
  const live = [...p.nodes.values()];
  const slice = slices(p.layout).find(
    (s) =>
      !live.some((n) => sameNet(n.slice, s)) &&
      !held.some((h) => sameNet(h.slice, s)) &&
      !p.external.some((x) => overlaps(x.prefix, s)),
  );
  const capacity = Math.min(size(meshGeneration(p.layout, "a")) - 2, 255);
  let ordinal: number | undefined;
  for (let o = 1; o <= capacity && ordinal === undefined; o++) {
    if (!live.some((n) => n.ordinal === o) && !held.some((h) => h.ordinal === o)) ordinal = o;
  }
  if (!slice || ordinal === undefined) {
    return Result.err(ipamError.noSlice(p.nodes.size, held.length));
  }
  const alloc = { slice, ordinal };
  p.nodes.set(node, alloc);
  return Result.ok(alloc);
}

/**
 * Removes a node. Its slice, ordinal and every scope network on it are held
 * until all forwarding peers acknowledge (the removed node never needs to).
 * Returns the quarantine id, or null when no other peer can forward.
 */
export function removeNode(
  p: AddressPlan,
  node: string,
  forwardingPeers: ReadonlySet<string>,
): Result<number | null, IpamError> {
  const alloc = p.nodes.get(node);
  if (!alloc) return Result.err(ipamError.unknownNode(node));
  p.nodes.delete(node);
  for (const [scope, nets] of p.scopes) {
    const net = nets.get(node);
    if (net) {
      nets.delete(node);
      p.endpoints.delete(formatNet(net));
    }
    if (nets.size === 0) p.scopes.delete(scope);
  }
  const awaiting = new Set(forwardingPeers);
  awaiting.delete(node);
  return Result.ok(hold(p, { kind: "nodeSlice", ...alloc }, awaiting));
}

/** A node's stable control address, independent of the mesh key generation. */
export function stableMeshAddress(p: AddressPlan, node: string): number | null {
  const alloc = p.nodes.get(node);
  return alloc ? host(meshStable(p.layout), alloc.ordinal) : null;
}

/** A node's mesh interface address in one generation. */
export function meshAddress(p: AddressPlan, node: string, g: MeshGeneration): number | null {
  const alloc = p.nodes.get(node);
  return alloc ? host(meshGeneration(p.layout, g), alloc.ordinal) : null;
}
