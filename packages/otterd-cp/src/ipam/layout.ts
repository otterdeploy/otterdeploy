/**
 * How the fleet supernet is divided, as the node's address plan divides it:
 *
 * | Range      | Default            | Use                                          |
 * |------------|--------------------|----------------------------------------------|
 * | supernet   | `172.24.0.0/13`    | everything below                             |
 * | VIP        | `172.31.0.0/16`    | stable service addresses, never reused       |
 * | system     | `172.30.224.0/19`  | mesh generations and DNS listeners           |
 * | mesh       | `172.30.224.0/23`  | A and B interface /25s, then a stable /24    |
 * | DNS        | `172.30.228.0/22`  | per-environment resolver addresses           |
 * | node slices| remaining /19s     | one per node, 256 /27 scope units each       |
 *
 * Reserved ranges are taken before any node slice, so adding nodes never
 * collides with them.
 */
import { Result } from "better-result";

import { type Net, covers, formatNet, overlaps, parseNet, subnet, subnetCount } from "./addr";

/** Prefix length of a node slice. */
const SLICE_LEN = 19;
/** Prefix length of one scope unit, the allocation and policy granule. */
export const UNIT_LEN = 27;
/** Largest managed network: a /24, eight units. */
export const LARGEST_SCOPE_LEN = 24;

export type MeshGeneration = "a" | "b";

export interface Layout {
  supernet: Net;
  vip: Net;
  system: Net;
  mesh: Net;
  dns: Net;
}

const LAYOUT_KEYS = ["supernet", "vip", "system", "mesh", "dns"] as const;

export const DEFAULT_LAYOUT: Layout = {
  supernet: { addr: 0xac180000, len: 13 },
  vip: { addr: 0xac1f0000, len: 16 },
  system: { addr: 0xac1ee000, len: 19 },
  mesh: { addr: 0xac1ee000, len: 23 },
  dns: { addr: 0xac1ee400, len: 22 },
};

/** Checks containment, alignment and disjointness; the first violated rule. */
export function validateLayout(l: Layout): Result<Layout, string> {
  if (l.supernet.len > SLICE_LEN) {
    return Result.err(`supernet ${formatNet(l.supernet)} must be /${SLICE_LEN} or larger`);
  }
  const nested = [
    ["VIP range", l.vip, l.supernet],
    ["system range", l.system, l.supernet],
    ["mesh range", l.mesh, l.system],
    ["DNS range", l.dns, l.system],
  ] as const;
  for (const [what, range, outer] of nested) {
    if (!covers(outer, range)) {
      return Result.err(`${what} ${formatNet(range)} is not inside ${formatNet(outer)}`);
    }
  }
  for (const r of [l.vip, l.system]) {
    if (r.len > SLICE_LEN) {
      return Result.err(
        `${formatNet(r)} must be /${SLICE_LEN} or larger so it takes whole node slices`,
      );
    }
  }
  if (l.mesh.len !== 23) {
    return Result.err(
      `mesh range ${formatNet(l.mesh)} must be exactly a /23 (two /25 generations and a stable /24)`,
    );
  }
  for (const [a, b] of [
    [l.vip, l.system],
    [l.mesh, l.dns],
  ] as const) {
    if (overlaps(a, b)) return Result.err(`${formatNet(a)} and ${formatNet(b)} overlap`);
  }
  return Result.ok(l);
}

/** The /25 holding one mesh generation's interface addresses. */
export const meshGeneration = (l: Layout, g: MeshGeneration): Net =>
  subnet(l.mesh, 25, g === "a" ? 0 : 1) ?? l.mesh;

/** The /24 holding each node's stable control address. */
export const meshStable = (l: Layout): Net => subnet(l.mesh, 24, 1) ?? l.mesh;

/** Node slices in allocation order: every /19 of the supernet not reserved. */
export function slices(l: Layout): Net[] {
  const out: Net[] = [];
  for (let i = 0; i < subnetCount(l.supernet, SLICE_LEN); i++) {
    const s = subnet(l.supernet, SLICE_LEN, i);
    if (s && !overlaps(s, l.vip) && !overlaps(s, l.system)) out.push(s);
  }
  return out;
}

/** Usable endpoint addresses in a network of this length: all but the
 *  network address, the bridge gateway (`.1`) and broadcast. */
export const usableEndpoints = (len: number) => 2 ** (32 - Math.min(len, 30)) - 3;

export const layoutToJson = (l: Layout): Record<(typeof LAYOUT_KEYS)[number], string> => ({
  supernet: formatNet(l.supernet),
  vip: formatNet(l.vip),
  system: formatNet(l.system),
  mesh: formatNet(l.mesh),
  dns: formatNet(l.dns),
});

export function layoutFromJson(v: Record<(typeof LAYOUT_KEYS)[number], string>) {
  return Result.gen(function* () {
    const layout: Layout = {
      supernet: yield* parseNet(v.supernet),
      vip: yield* parseNet(v.vip),
      system: yield* parseNet(v.system),
      mesh: yield* parseNet(v.mesh),
      dns: yield* parseNet(v.dns),
    };
    return validateLayout(layout);
  });
}
