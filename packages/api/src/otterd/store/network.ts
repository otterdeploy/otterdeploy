/**
 * The fleet address plan in Postgres. Every allocation and release runs
 * inside the transaction that needs it (admitting a grant, releasing one,
 * recording a fence) and writes the plan back with an optimistic revision
 * check, so two writers can never both commit from the same plan: the
 * later one is refused and its transaction rolls back.
 *
 * A grant's address is released only when the grant is: the owner's stop
 * acknowledgement covers the owner, and every other node that was sent a
 * serving set listing one of the grant's attempts must acknowledge the
 * drain or be fenced first.
 */
import {
  type GrantNetwork,
  otterdGrant,
  otterdServiceRevision,
} from "@otterdeploy/db/schema/otterd";
import { otterdScope, otterdServing } from "@otterdeploy/db/schema/otterd-network";
import { ipam } from "@otterdeploy/otterd-cp";
import { serviceSpec } from "@otterdeploy/otterd-proto";
import { and, count, eq } from "drizzle-orm";

import type { Tx } from "../../health-data/sql";
import type { GrantRow } from "./rows";

import { refusal } from "./errors";
import { journal } from "./journal";
import { type LoadedPlan, readPlan, writePlan } from "./plan-row";
import { ensureVip } from "./vip";

/** Each environment's names live under `<scope>.otd.internal`. */
const ZONE_SUFFIX = "otd.internal";

const ipamRefusal = (e: ipam.IpamError) => refusal(`address-${e.kind}`, e.message);

/** The scope's zone and resolver listener, created on first use and never reused. */
async function ensureScope(tx: Tx, loaded: LoadedPlan, scopeId: string, now: number) {
  const [existing] = await tx.select().from(otterdScope).where(eq(otterdScope.scopeId, scopeId));
  if (existing) return existing;
  const [taken] = await tx.select({ n: count() }).from(otterdScope);
  const resolver = ipam.resolverAddress(loaded.plan, (taken?.n ?? 0) + 1);
  if (resolver === null) throw refusal("address-dns-exhausted", "no resolver address left");
  const [row] = await tx
    .insert(otterdScope)
    .values({
      scopeId,
      zone: `${scopeId}.${ZONE_SUFFIX}`,
      resolver: ipam.formatAddr(resolver),
      createdAt: now,
    })
    .returning();
  if (!row) throw refusal("insert-failed", `scope ${scopeId} not inserted`);
  return row;
}

/**
 * The network a new grant's attempt joins, allocated in the admitting
 * transaction. Null when the service names no scope: its attempt keeps the
 * Engine's default bridge.
 */
export async function allocateNetwork(
  tx: Tx,
  req: { resourceId: string; specRevision: number; nodeId: string; now: number },
): Promise<GrantNetwork | null> {
  const [rev] = await tx
    .select()
    .from(otterdServiceRevision)
    .where(
      and(
        eq(otterdServiceRevision.resourceId, req.resourceId),
        eq(otterdServiceRevision.revision, req.specRevision),
      ),
    );
  const spec = serviceSpec.safeParse(rev?.spec);
  const scopeId = spec.success ? spec.data.endpoint.scopes?.[0] : undefined;
  if (!spec.success || scopeId === undefined) return null;
  const loaded = await readPlan(tx);
  const place = ipam.placeAttempt(loaded.plan, scopeId, req.nodeId);
  if (place.isErr()) throw ipamRefusal(place.error);
  const scope = await ensureScope(tx, loaded, scopeId, req.now);
  const vip = await ensureVip(tx, loaded, req.resourceId, spec.data, req.now);
  await writePlan(tx, loaded, req.now);
  return {
    scopeId,
    subnet: ipam.formatNet(place.value.subnet),
    address: ipam.formatAddr(place.value.address),
    resolver: scope.resolver,
    zone: scope.zone,
    ...(vip ? { vip } : {}),
  };
}

/**
 * Nodes other than the owner that were told about one of the grant's
 * attempts. Their listing is dropped here: from now on the quarantine entry
 * carries them.
 */
async function forwardingPeers(tx: Tx, g: GrantRow): Promise<Set<string>> {
  const [serving] = await tx
    .select()
    .from(otterdServing)
    .where(eq(otterdServing.resourceId, g.resourceId))
    .for("update");
  if (!serving) return new Set();
  const peers = new Set(g.attempts.flatMap((a) => serving.listed[a] ?? []));
  peers.delete(g.nodeId);
  const listed = Object.fromEntries(
    Object.entries(serving.listed).filter(([a]) => !g.attempts.includes(a)),
  );
  await tx.update(otterdServing).set({ listed }).where(eq(otterdServing.resourceId, g.resourceId));
  return peers;
}

/** Give a released grant's address back to the plan, held for its forwarding peers. */
export async function releaseNetwork(tx: Tx, g: GrantRow, now: number): Promise<void> {
  if (!g.network || g.networkReleasedAt !== null) return;
  const address = ipam.parseAddr(g.network.address);
  if (address === null) return;
  await tx
    .update(otterdGrant)
    .set({ networkReleasedAt: now })
    .where(eq(otterdGrant.grantId, g.grantId));
  const peers = await forwardingPeers(tx, g);
  const loaded = await readPlan(tx);
  const held = ipam.releaseEndpoint(loaded.plan, address, peers);
  if (held.isOk()) await writePlan(tx, loaded, now);
  await journal(tx, {
    at: now,
    kind: "address-released",
    resourceId: g.resourceId,
    slotIndex: g.slotIndex,
    nodeId: g.nodeId,
    grantId: g.grantId,
    detail: held.isOk()
      ? { address: g.network.address, quarantineId: held.value, awaiting: [...peers].sort() }
      : { address: g.network.address, notLive: held.error.message },
  });
}

/** A fenced node no longer holds back any address it might have forwarded to. */
export async function fenceNetworkPeer(tx: Tx, nodeId: string, now: number): Promise<void> {
  const loaded = await readPlan(tx);
  if (loaded.plan.quarantine.length === 0) return;
  const released = ipam.peerFenced(loaded.plan, nodeId);
  await writePlan(tx, loaded, now);
  if (released.length > 0) {
    await journal(tx, { at: now, kind: "addresses-freed", nodeId, detail: { released } });
  }
}
