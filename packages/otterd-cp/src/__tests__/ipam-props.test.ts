/**
 * The address plan's safety properties over many random operation sequences:
 * no live network overlaps another or a range still held for a peer, no live
 * endpoint is an address still held, and a VIP address is never handed out
 * twice. Seeded, so a failure reproduces.
 */
import { describe, expect, test } from "bun:test";

import {
  type AddressPlan,
  DEFAULT_LAYOUT,
  acknowledge,
  allocateEndpoint,
  allocateScope,
  allocateVip,
  enrollNode,
  newPlan,
  overlaps,
  peerFenced,
  releaseEndpoint,
  releaseScope,
  retireVip,
} from "../ipam/index";

function rng(seed: number) {
  let s = seed >>> 0;
  return (n: number) => {
    s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0;
    return s % n;
  };
}

const PEERS = new Set(["p0", "p1", "p2"]);
const LENS = [24, 25, 26, 27];

function check(p: AddressPlan) {
  const live = [...p.scopes.values()].flatMap((m) => [...m.values()]);
  const heldNets = p.quarantine.flatMap((q) =>
    q.held.kind === "scopeNetwork" ? [q.held.prefix] : [],
  );
  live.forEach((a, i) => {
    for (const b of live.slice(i + 1)) expect(overlaps(a, b)).toBe(false);
    for (const h of heldNets) expect(overlaps(a, h)).toBe(false);
  });
  const heldAddrs = new Set(
    p.quarantine.flatMap((q) => (q.held.kind === "endpoint" ? [q.held.addr] : [])),
  );
  for (const e of p.endpoints.values())
    for (const a of e.live) expect(heldAddrs.has(a)).toBe(false);
}

function step(p: AddressPlan, r: (n: number) => number, vipsSeen: Set<number>) {
  const scope = `s${r(12)}`;
  const peer = `p${r(3)}`;
  switch (r(7)) {
    case 0:
      allocateScope(p, scope, "w1", LENS[r(4)] ?? 27);
      return;
    case 1:
      releaseScope(p, scope, "w1", PEERS);
      return;
    case 2: {
      const a = allocateEndpoint(p, scope, "w1");
      if (a.isOk() && r(2) === 0) releaseEndpoint(p, a.value, PEERS);
      return;
    }
    case 3:
      for (const q of p.quarantine) acknowledge(p, q.id, peer);
      return;
    case 4:
      peerFenced(p, peer);
      return;
    case 5: {
      const v = allocateVip(p, `v${r(4)}`);
      if (v.isOk()) {
        expect(vipsSeen.has(v.value)).toBe(false);
        vipsSeen.add(v.value);
      }
      return;
    }
    default:
      retireVip(p, `v${r(4)}`);
  }
}

describe("address plan properties", () => {
  test("live networks and endpoints never reuse a held range; VIPs never repeat", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed);
      const p = newPlan(DEFAULT_LAYOUT).unwrap();
      enrollNode(p, "w1").unwrap();
      const vips = new Set<number>();
      for (let i = 0; i < 80; i++) {
        step(p, r, vips);
        check(p);
      }
    }
  });
});
