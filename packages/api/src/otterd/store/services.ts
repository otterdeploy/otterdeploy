/**
 * Service specifications and their rollout state. A changed specification is
 * a new revision; a rollback is also a new revision (with an older spec),
 * never a resurrection of an old grant.
 */
import { otterdService, otterdServiceRevision } from "@otterdeploy/db/schema/otterd";
import { type ServiceSpec, isAdmissible, validateServiceSpec } from "@otterdeploy/otterd-proto";
import { Result } from "better-result";
import { and, eq, sql } from "drizzle-orm";

import { type StoreFailure, refusal, run } from "./errors";
import { journal } from "./journal";

/** Key-order independent JSON (jsonb does not keep key order). */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const keys = Object.keys(v).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(Reflect.get(v, k))}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

const same = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);

/** Create or update a service. Returns its revision; an unchanged spec keeps it. */
export function putService(spec: ServiceSpec, now: number): Promise<Result<number, StoreFailure>> {
  return run(async (tx) => {
    if (!isAdmissible(spec)) {
      throw refusal("spec-invalid", JSON.stringify(validateServiceSpec(spec)));
    }
    const [svc] = await tx
      .select()
      .from(otterdService)
      .where(eq(otterdService.resourceId, spec.resourceId))
      .for("update");
    if (!svc) {
      await tx
        .insert(otterdService)
        .values({ resourceId: spec.resourceId, revision: 1, createdAt: now, updatedAt: now });
      await tx
        .insert(otterdServiceRevision)
        .values({ resourceId: spec.resourceId, revision: 1, spec, createdAt: now });
      await journal(tx, {
        at: now,
        kind: "service-created",
        resourceId: spec.resourceId,
        detail: { revision: 1 },
      });
      return 1;
    }
    const [current] = await tx
      .select()
      .from(otterdServiceRevision)
      .where(
        and(
          eq(otterdServiceRevision.resourceId, spec.resourceId),
          eq(otterdServiceRevision.revision, svc.revision),
        ),
      );
    if (current && same(current.spec, spec)) return svc.revision;
    const revision = svc.revision + 1;
    await tx
      .insert(otterdServiceRevision)
      .values({ resourceId: spec.resourceId, revision, spec, createdAt: now });
    await tx
      .update(otterdService)
      .set({ revision, rolloutPaused: false, updatedAt: now })
      .where(eq(otterdService.resourceId, spec.resourceId));
    await journal(tx, {
      at: now,
      kind: "service-updated",
      resourceId: spec.resourceId,
      detail: { revision },
    });
    return revision;
  });
}

export type RolloutOutcome = "completed" | "paused" | "rollback";

/** Apply a rollout outcome the planner decided. A rollback copies the stable spec forward. */
export function recordRollout(
  resourceId: string,
  outcome: RolloutOutcome,
  revision: number,
  now: number,
): Promise<Result<void, StoreFailure>> {
  return run(async (tx) => {
    const key = eq(otterdService.resourceId, resourceId);
    if (outcome === "completed") {
      await tx.update(otterdService).set({ stableRevision: revision, updatedAt: now }).where(key);
    } else if (outcome === "paused") {
      await tx.update(otterdService).set({ rolloutPaused: true, updatedAt: now }).where(key);
    } else {
      const [svc] = await tx.select().from(otterdService).where(key).for("update");
      const [stable] = await tx
        .select()
        .from(otterdServiceRevision)
        .where(
          and(
            eq(otterdServiceRevision.resourceId, resourceId),
            eq(otterdServiceRevision.revision, revision),
          ),
        );
      if (!svc || !stable) throw refusal("unknown-revision", `${resourceId}@${revision}`);
      const next = svc.revision + 1;
      await tx
        .insert(otterdServiceRevision)
        .values({ resourceId, revision: next, spec: stable.spec, createdAt: now });
      await tx
        .update(otterdService)
        .set({ revision: next, rolloutPaused: false, updatedAt: now })
        .where(key);
    }
    await journal(tx, { at: now, kind: `rollout-${outcome}`, resourceId, detail: { revision } });
  });
}

/** A slot became healthy at the service's revision: the next one may start after `update.delayMs`. */
export function markSlotUpdated(
  resourceId: string,
  now: number,
): Promise<Result<void, StoreFailure>> {
  return run(async (tx) => {
    await tx
      .update(otterdService)
      .set({ lastSlotUpdatedAt: now })
      .where(eq(otterdService.resourceId, resourceId));
  });
}

/** Remember where a `stay` service's data lives, once. */
export function setHomeNode(
  resourceId: string,
  nodeId: string,
): Promise<Result<void, StoreFailure>> {
  return run(async (tx) => {
    await tx
      .update(otterdService)
      .set({ homeNode: sql`coalesce(${otterdService.homeNode}, ${nodeId})` })
      .where(eq(otterdService.resourceId, resourceId));
  });
}

export function setPaused(
  resourceId: string,
  paused: boolean,
  now: number,
): Promise<Result<void, StoreFailure>> {
  return run(async (tx) => {
    await tx
      .update(otterdService)
      .set({ paused, updatedAt: now })
      .where(eq(otterdService.resourceId, resourceId));
    await journal(tx, {
      at: now,
      kind: paused ? "service-paused" : "service-resumed",
      resourceId,
      detail: {},
    });
  });
}

export interface ServiceRevision {
  spec: Record<string, unknown>;
  /** The resource's newest operation epoch: commands must carry at least it. */
  operationEpoch: number;
}

/** A revision's spec and the resource's current operation epoch. */
export function revisionOf(
  resourceId: string,
  revision: number,
): Promise<Result<ServiceRevision, StoreFailure>> {
  return run(async (tx) => {
    const [svc] = await tx
      .select()
      .from(otterdService)
      .where(eq(otterdService.resourceId, resourceId));
    const [rev] = await tx
      .select()
      .from(otterdServiceRevision)
      .where(
        and(
          eq(otterdServiceRevision.resourceId, resourceId),
          eq(otterdServiceRevision.revision, revision),
        ),
      );
    if (!svc || !rev) throw refusal("unknown-revision", `${resourceId}@${revision}`);
    return { spec: rev.spec, operationEpoch: svc.operationEpoch };
  });
}
