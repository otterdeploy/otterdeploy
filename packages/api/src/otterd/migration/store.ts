/**
 * The migration session and each resource's journalled progress. While a
 * resource is held (any state short of migrated or rolled back) its owner is
 * `migrating`: the legacy deploy paths refuse it, and the scheduler leaves it
 * to the migration, so only the migration acts on it.
 */
import { db } from "@otterdeploy/db";
import {
  type BeforeImage,
  otterdMigrationResource,
  otterdMigrationSession,
} from "@otterdeploy/db/schema/otterd-migration";
import { resource } from "@otterdeploy/db/schema/project";
import { idSchema } from "@otterdeploy/shared/id";
import { Result } from "better-result";
import { and, eq, inArray, notInArray } from "drizzle-orm";

import type { Tx } from "../../health-data/sql";

import { type StoreFailure, mintId, refusal, run, toStoreFailure } from "../store/errors";
import { journal } from "../store/journal";

export type MigrationRow = typeof otterdMigrationResource.$inferSelect;
export type MigrationState =
  | "held"
  | "restart-disabled"
  | "adopt-requested"
  | "adopted"
  | "migrated"
  | "release-requested"
  | "released"
  | "rolled-back"
  | "failed";

/** States in which the resource belongs to nobody but the migration. */
const SETTLED: MigrationState[] = ["migrated", "rolled-back"];

export function openSession(by: string, now: number): Promise<Result<string, StoreFailure>> {
  return run(async (tx) => {
    const [live] = await tx
      .select()
      .from(otterdMigrationSession)
      .where(inArray(otterdMigrationSession.state, ["open", "finalizing"]));
    if (live) return live.sessionId;
    const sessionId = mintId("migration");
    await tx
      .insert(otterdMigrationSession)
      .values({ sessionId, state: "open", openedBy: by, openedAt: now });
    await journal(tx, { at: now, kind: "migration-opened", detail: { sessionId, by } });
    return sessionId;
  });
}

export const currentSession = () =>
  Result.tryPromise({
    try: async () => {
      const [s] = await db
        .select()
        .from(otterdMigrationSession)
        .where(inArray(otterdMigrationSession.state, ["open", "finalizing", "finalized"]));
      return s ?? null;
    },
    catch: toStoreFailure,
  });

export function setSessionState(sessionId: string, state: string, now: number) {
  return run(async (tx) => {
    await tx
      .update(otterdMigrationSession)
      .set({ state, ...(state === "finalized" ? { finalizedAt: now } : {}) })
      .where(eq(otterdMigrationSession.sessionId, sessionId));
    await journal(tx, { at: now, kind: `migration-${state}`, detail: { sessionId } });
  });
}

/** Take the resource for the migration: legacy → migrating, journalled. */
export function holdResource(
  sessionId: string,
  resourceId: string,
  fields: {
    nodeId: string;
    serviceName: string;
    containerId: string | null;
    beforeImage: BeforeImage | null;
  },
  now: number,
): Promise<Result<MigrationRow, StoreFailure>> {
  return run(async (tx) => {
    const id = idSchema.resource.safeParse(resourceId);
    if (!id.success) throw refusal("unknown-resource", `no resource ${resourceId}`);
    const [owned] = await tx
      .update(resource)
      .set({ runtimeOwner: "migrating" })
      .where(and(eq(resource.id, id.data), eq(resource.runtimeOwner, "legacy")))
      .returning({ id: resource.id });
    if (!owned)
      throw refusal("not-legacy", `resource ${resourceId} is not owned by the legacy runtime`);
    const values = {
      resourceId,
      sessionId,
      state: "held",
      ...fields,
      grantId: null,
      error: null,
      updatedAt: now,
    };
    const [row] = await tx
      .insert(otterdMigrationResource)
      .values(values)
      .onConflictDoUpdate({ target: otterdMigrationResource.resourceId, set: values })
      .returning();
    if (!row) throw refusal("insert-failed", `migration of ${resourceId} not recorded`);
    await journal(tx, {
      at: now,
      kind: "migration-held",
      resourceId,
      detail: { ...fields, beforeImage: undefined },
    });
    return row;
  });
}

/** Move a held resource on; `owner` also switches the resource's owner. */
export function stepResource(
  resourceId: string,
  state: MigrationState,
  now: number,
  patch: Partial<Pick<MigrationRow, "grantId" | "error">> & {
    owner?: "otterd" | "legacy" | "migrating";
  } = {},
): Promise<Result<MigrationRow, StoreFailure>> {
  return run(async (tx) => {
    const { owner, ...rest } = patch;
    const [row] = await tx
      .update(otterdMigrationResource)
      .set({ state, ...rest, updatedAt: now })
      .where(eq(otterdMigrationResource.resourceId, resourceId))
      .returning();
    if (!row) throw refusal("not-migrating", `resource ${resourceId} has no migration`);
    const id = idSchema.resource.safeParse(resourceId);
    if (owner && id.success) {
      await tx.update(resource).set({ runtimeOwner: owner }).where(eq(resource.id, id.data));
    }
    await journal(tx, {
      at: now,
      kind: `migration-${state}`,
      resourceId,
      detail: { ...rest, ...(owner ? { owner } : {}) },
    });
    return row;
  });
}

export const migrationRow = (resourceId: string) =>
  Result.tryPromise({
    try: async () => {
      const [row] = await db
        .select()
        .from(otterdMigrationResource)
        .where(eq(otterdMigrationResource.resourceId, resourceId));
      return row ?? null;
    },
    catch: toStoreFailure,
  });

/** Rows the control plane has work for, in the given states. */
export const rowsIn = (states: MigrationState[]) =>
  Result.tryPromise({
    try: () =>
      db
        .select()
        .from(otterdMigrationResource)
        .where(inArray(otterdMigrationResource.state, states)),
    catch: toStoreFailure,
  });

/** Every migration row, for the admin state. */
export const allRows = () =>
  Result.tryPromise({
    try: () => db.select().from(otterdMigrationResource),
    catch: toStoreFailure,
  });

/** Resources the scheduler must leave alone: held by an unsettled migration. */
export async function heldResourceIds(q: Tx | typeof db = db): Promise<Set<string>> {
  const rows = await q
    .select({ resourceId: otterdMigrationResource.resourceId })
    .from(otterdMigrationResource)
    .where(notInArray(otterdMigrationResource.state, SETTLED));
  return new Set(rows.map((r) => r.resourceId));
}

/** The install's migration onto otterd is finalized: the legacy runtime is gone. */
export async function migrationFinalized(): Promise<boolean> {
  const s = await currentSession();
  return s.isOk() && s.value?.state === "finalized";
}
