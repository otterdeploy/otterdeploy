import type { Result } from "better-result";

/**
 * Parity with the node's address plan. The node records one fixed script of
 * operations with each result (or error kind and message) and the whole plan
 * after it; this port replays the operations and must reproduce every step,
 * results and state alike. Regenerate the vectors on the node side only.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { z } from "zod";

import {
  type AddressPlan,
  DEFAULT_LAYOUT,
  type IpamError,
  acknowledge,
  allocateEndpoint,
  allocateScope,
  allocateVip,
  enrollNode,
  formatAddr,
  formatNet,
  layoutToJson,
  meshAddress,
  newPlan,
  nodeAllocJson,
  parseAddr,
  parseNet,
  peerFenced,
  planFromJson,
  planToJson,
  releaseEndpoint,
  releaseScope,
  removeNode,
  reserveExternal,
  retireVip,
  stableMeshAddress,
  usableEndpoints,
} from "../ipam/index";

const VECTORS = new URL(
  "../../../../apps/otterd/crates/otterd-net/fixtures/ipam-vectors.json",
  import.meta.url,
);

const step = z.object({
  op: z.looseObject({ op: z.string() }),
  result: z.union([
    z.object({ ok: z.unknown() }),
    z.object({ err: z.object({ kind: z.string(), message: z.string() }) }),
  ]),
  plan: z.unknown(),
});

const vectors = z
  .object({
    layout: z.unknown(),
    usableEndpoints: z.array(z.object({ len: z.number(), usable: z.number() })),
    steps: z.array(step),
  })
  .parse(JSON.parse(readFileSync(VECTORS, "utf8")));

const str = (v: unknown) => z.string().parse(v);
const num = (v: unknown) => z.number().parse(v);
const peers = (v: unknown) => new Set(z.array(z.string()).parse(v));
const net = (v: unknown) => parseNet(str(v)).unwrap();
const addr = (v: unknown) => {
  const a = parseAddr(str(v));
  if (a === null) throw new Error(`bad address ${String(v)}`);
  return a;
};
const opt = (a: number | null) => (a === null ? null : formatAddr(a));

type Outcome = { ok: unknown } | { err: { kind: string; message: string } };
type Op = Record<string, unknown>;

const wrap = <T>(r: Result<T, IpamError>, f: (v: T) => unknown): Outcome =>
  r.match<Outcome>({ ok: (v) => ({ ok: f(v) }), err: (err) => ({ err }) });

const OPS: Record<string, (p: AddressPlan, o: Op) => Outcome> = {
  enrollNode: (p, o) => wrap(enrollNode(p, str(o.node)), nodeAllocJson),
  removeNode: (p, o) => wrap(removeNode(p, str(o.node), peers(o.forwardingPeers)), (v) => v),
  allocateScope: (p, o) => wrap(allocateScope(p, str(o.scope), str(o.node), num(o.len)), formatNet),
  releaseScope: (p, o) =>
    wrap(releaseScope(p, str(o.scope), str(o.node), peers(o.forwardingPeers)), (v) => v),
  allocateEndpoint: (p, o) => wrap(allocateEndpoint(p, str(o.scope), str(o.node)), formatAddr),
  releaseEndpoint: (p, o) =>
    wrap(releaseEndpoint(p, addr(o.address), peers(o.forwardingPeers)), (v) => v),
  allocateVip: (p, o) => wrap(allocateVip(p, str(o.vip)), formatAddr),
  retireVip: (p, o) => ({ ok: opt(retireVip(p, str(o.vip))) }),
  acknowledge: (p, o) => wrap(acknowledge(p, num(o.id), str(o.peer)), (v) => v),
  peerFenced: (p, o) => ({ ok: peerFenced(p, str(o.peer)) }),
  reserveExternal: (p, o) => wrap(reserveExternal(p, net(o.prefix), str(o.source)), (v) => v),
  meshAddresses: (p, o) => ({
    ok: {
      stable: opt(stableMeshAddress(p, str(o.node))),
      a: opt(meshAddress(p, str(o.node), "a")),
      b: opt(meshAddress(p, str(o.node), "b")),
    },
  }),
};

describe("address plan parity with the node", () => {
  test("the default layout and usable-endpoint table match", () => {
    expect(layoutToJson(DEFAULT_LAYOUT)).toEqual(
      z.record(z.string(), z.string()).parse(vectors.layout),
    );
    for (const { len, usable } of vectors.usableEndpoints)
      expect(usableEndpoints(len)).toBe(usable);
  });

  test("every step reproduces the node's result and plan", () => {
    const plan = newPlan(DEFAULT_LAYOUT).unwrap();
    const seen = new Set<string>();
    vectors.steps.forEach((s, i) => {
      const run = OPS[s.op.op];
      if (!run) throw new Error(`step ${i}: unknown op ${s.op.op}`);
      seen.add(s.op.op);
      const result: unknown = run(plan, s.op);
      expect({ i, op: s.op, result }).toEqual({ i, op: s.op, result: s.result });
      const state: unknown = planToJson(plan);
      expect({ i, plan: state }).toEqual({ i, plan: s.plan });
    });
    expect([...seen].sort()).toEqual(Object.keys(OPS).sort());
  });

  test("a stored plan round-trips through its JSON form", () => {
    const plan = newPlan(DEFAULT_LAYOUT).unwrap();
    for (const s of vectors.steps) OPS[s.op.op]?.(plan, s.op);
    const json = planToJson(plan);
    const back = planFromJson(JSON.parse(JSON.stringify(json))).unwrap();
    expect(planToJson(back)).toEqual(json);
  });
});
