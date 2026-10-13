/**
 * The durable fleet address plan and its JSON form. The JSON is the same
 * document the node's plan serializes to, so a stored plan can be compared
 * field for field with the node's, and the caller journals it after every
 * successful mutation.
 */
import { Result } from "better-result";
import { z } from "zod";

import { type Net, compareNet, formatAddr, formatNet, parseAddr, parseNet } from "./addr";
import { type Layout, layoutFromJson, layoutToJson } from "./layout";

export interface NodeAlloc {
  /** The node's /19. */
  slice: Net;
  /** 1-based; the host part of the node's mesh address in either generation. */
  ordinal: number;
}

/** What a quarantine entry holds back. */
export type Held =
  | { kind: "nodeSlice"; slice: Net; ordinal: number }
  | { kind: "scopeNetwork"; prefix: Net }
  | { kind: "endpoint"; network: Net; addr: number };

/** An address held until every forwarding peer has acknowledged cleanup. */
export interface Quarantine {
  id: number;
  held: Held;
  /** Peers that have not yet acknowledged and are not fenced. */
  awaiting: Set<string>;
}

/** An inventory prefix (bridge, route, VPN) that managed ranges must avoid. */
export interface External {
  prefix: Net;
  source: string;
}

export interface AddressPlan {
  layout: Layout;
  nodes: Map<string, NodeAlloc>;
  /** scope → node → network. */
  scopes: Map<string, Map<string, Net>>;
  /** Live endpoint addresses, keyed by their network's text form. */
  endpoints: Map<string, { network: Net; live: Set<number> }>;
  vips: Map<string, number>;
  nextVip: number;
  quarantine: Quarantine[];
  nextQuarantine: number;
  external: External[];
}

export const emptyPlan = (layout: Layout): AddressPlan => ({
  layout,
  nodes: new Map(),
  scopes: new Map(),
  endpoints: new Map(),
  vips: new Map(),
  // .0 is the VIP range's network address.
  nextVip: 1,
  quarantine: [],
  nextQuarantine: 1,
  external: [],
});

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const sorted = <V>(m: Map<string, V>) => [...m.entries()].sort(([a], [b]) => byText(a, b));

export const nodeAllocJson = (n: NodeAlloc) => ({ slice: formatNet(n.slice), ordinal: n.ordinal });

function heldJson(h: Held) {
  switch (h.kind) {
    case "nodeSlice":
      return { kind: h.kind, slice: formatNet(h.slice), ordinal: h.ordinal };
    case "scopeNetwork":
      return { kind: h.kind, prefix: formatNet(h.prefix) };
    case "endpoint":
      return { kind: h.kind, network: formatNet(h.network), addr: formatAddr(h.addr) };
  }
}

export function planToJson(p: AddressPlan) {
  const endpoints = [...p.endpoints.values()].sort((a, b) => compareNet(a.network, b.network));
  return {
    layout: layoutToJson(p.layout),
    nodes: Object.fromEntries(sorted(p.nodes).map(([id, n]) => [id, nodeAllocJson(n)])),
    scopes: Object.fromEntries(
      sorted(p.scopes).map(([id, nets]) => [
        id,
        Object.fromEntries(sorted(nets).map(([node, net]) => [node, formatNet(net)])),
      ]),
    ),
    endpoints: Object.fromEntries(
      endpoints.map((e) => [
        formatNet(e.network),
        [...e.live].sort((a, b) => a - b).map(formatAddr),
      ]),
    ),
    vips: Object.fromEntries(sorted(p.vips).map(([id, a]) => [id, formatAddr(a)])),
    nextVip: p.nextVip,
    quarantine: p.quarantine.map((q) => ({
      id: q.id,
      held: heldJson(q.held),
      awaiting: [...q.awaiting].sort(byText),
    })),
    nextQuarantine: p.nextQuarantine,
    external: p.external.map((x) => ({ prefix: formatNet(x.prefix), source: x.source })),
  };
}

const net = z.string().transform((s, ctx) => {
  const r = parseNet(s);
  if (r.isErr()) {
    ctx.addIssue({ code: "custom", message: r.error });
    return z.NEVER;
  }
  return r.value;
});

const addr = z.string().transform((s, ctx) => {
  const a = parseAddr(s);
  if (a === null) {
    ctx.addIssue({ code: "custom", message: `${JSON.stringify(s)} is not an IPv4 address` });
    return z.NEVER;
  }
  return a;
});

const count = z.number().int().nonnegative();

const planJson = z.object({
  layout: z.object({
    supernet: z.string(),
    vip: z.string(),
    system: z.string(),
    mesh: z.string(),
    dns: z.string(),
  }),
  nodes: z.record(z.string(), z.object({ slice: net, ordinal: count })),
  scopes: z.record(z.string(), z.record(z.string(), net)),
  endpoints: z.record(z.string(), z.array(addr)),
  vips: z.record(z.string(), addr),
  nextVip: count,
  quarantine: z.array(
    z.object({
      id: count,
      held: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("nodeSlice"), slice: net, ordinal: count }),
        z.object({ kind: z.literal("scopeNetwork"), prefix: net }),
        z.object({ kind: z.literal("endpoint"), network: net, addr }),
      ]),
      awaiting: z.array(z.string()),
    }),
  ),
  nextQuarantine: count,
  external: z.array(z.object({ prefix: net, source: z.string() })),
});

/** A stored plan, parsed and its layout re-validated. */
export function planFromJson(value: unknown): Result<AddressPlan, string> {
  const parsed = planJson.safeParse(value);
  if (!parsed.success) return Result.err(parsed.error.message);
  const v = parsed.data;
  return layoutFromJson(v.layout).andThen((layout) => {
    const endpoints = new Map<string, { network: Net; live: Set<number> }>();
    for (const [key, live] of Object.entries(v.endpoints)) {
      const network = parseNet(key);
      if (network.isErr()) return Result.err(network.error);
      endpoints.set(formatNet(network.value), { network: network.value, live: new Set(live) });
    }
    return Result.ok({
      layout,
      nodes: new Map(Object.entries(v.nodes)),
      scopes: new Map(Object.entries(v.scopes).map(([s, m]) => [s, new Map(Object.entries(m))])),
      endpoints,
      vips: new Map(Object.entries(v.vips)),
      nextVip: v.nextVip,
      quarantine: v.quarantine.map((q) => ({ ...q, awaiting: new Set(q.awaiting) })),
      nextQuarantine: v.nextQuarantine,
      external: v.external,
    });
  });
}
