/**
 * service_mount CRUD. Each row is one mount (volume / bind / file) attached
 * to a service's container spec. File-type mounts carry their content
 * inline; volume/bind only carry the source pointer. See
 * packages/db/src/schema/project.ts for the column semantics.
 */

import type { ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { serviceMount } from "@otterdeploy/db/schema/project";
import { and, eq } from "drizzle-orm";

import type { ServiceMountRow } from "./index";

export async function listServiceMounts(serviceResourceId: ResourceId): Promise<ServiceMountRow[]> {
  return db
    .select()
    .from(serviceMount)
    .where(eq(serviceMount.serviceResourceId, serviceResourceId));
}

export async function upsertServiceMount(input: {
  serviceResourceId: ResourceId;
  type: "volume" | "bind" | "file";
  target: string;
  source: string | null;
  content: string | null;
  readOnly?: boolean;
}): Promise<ServiceMountRow> {
  // Upsert keyed on (service, target) — there can only be one mount at a
  // given container path, so a re-insert is semantically a replace.
  const [row] = await db
    .insert(serviceMount)
    .values({
      serviceResourceId: input.serviceResourceId,
      type: input.type,
      target: input.target,
      source: input.source,
      content: input.content,
      readOnly: input.readOnly ?? false,
    })
    .onConflictDoUpdate({
      target: [serviceMount.serviceResourceId, serviceMount.target],
      set: {
        type: input.type,
        source: input.source,
        content: input.content,
        readOnly: input.readOnly ?? false,
      },
    })
    .returning();
  if (!row) {
    throw new Error("service_mount upsert returned no row");
  }
  return row;
}

export async function deleteServiceMount(input: {
  serviceResourceId: ResourceId;
  target: string;
}): Promise<void> {
  await db
    .delete(serviceMount)
    .where(
      and(
        eq(serviceMount.serviceResourceId, input.serviceResourceId),
        eq(serviceMount.target, input.target),
      ),
    );
}

/**
 * Replace the entire mount set for a service in one transaction. Used by
 * the UI's "Save mounts" flow where the editor sends the full desired
 * state; rows not in the next set are dropped, surviving rows are
 * upserted. File content lives in `content`; pass undefined to leave it
 * unchanged when only metadata is editing.
 */
export async function bulkReplaceServiceMounts(
  serviceResourceId: ResourceId,
  next: ReadonlyArray<{
    type: "volume" | "bind" | "file";
    target: string;
    source: string | null;
    content: string | null;
    readOnly?: boolean;
  }>,
): Promise<ServiceMountRow[]> {
  return db.transaction(async (tx) => {
    await tx.delete(serviceMount).where(eq(serviceMount.serviceResourceId, serviceResourceId));
    if (next.length === 0) return [];
    return tx
      .insert(serviceMount)
      .values(
        next.map((m) => ({
          serviceResourceId,
          type: m.type,
          target: m.target,
          source: m.source,
          content: m.content,
          readOnly: m.readOnly ?? false,
        })),
      )
      .returning();
  });
}
