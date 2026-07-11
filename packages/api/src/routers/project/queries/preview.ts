/**
 * Read queries for `preview` rows — the first-class PR-preview entity.
 * Lifecycle writes (ensure/close) live in git/preview-env.ts next to the
 * webhook orchestration; these getters serve the deploy path, the builder
 * and the previews API.
 */
import type { PreviewId, ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { preview } from "@otterdeploy/db/schema/project";
import { and, asc, eq } from "drizzle-orm";

export type PreviewRow = typeof preview.$inferSelect;

export async function getPreviewById(id: PreviewId): Promise<PreviewRow | undefined> {
  const [row] = await db.select().from(preview).where(eq(preview.id, id)).limit(1);
  return row;
}

/** Open previews for a project, oldest first — feeds the graph satellites. */
export async function listActivePreviewsByProject(projectId: ProjectId): Promise<PreviewRow[]> {
  return db
    .select()
    .from(preview)
    .where(and(eq(preview.projectId, projectId), eq(preview.state, "active")))
    .orderBy(asc(preview.prNumber));
}

export async function setPreviewPaused(id: PreviewId, paused: boolean): Promise<void> {
  await db.update(preview).set({ paused, updatedAt: new Date() }).where(eq(preview.id, id));
}

/** Keep-alive control: null pins the preview (never idle-reaped). */
export async function setPreviewAutoTeardown(
  id: PreviewId,
  autoTeardownAt: Date | null,
): Promise<void> {
  await db.update(preview).set({ autoTeardownAt, updatedAt: new Date() }).where(eq(preview.id, id));
}

export async function markPreviewClosedById(id: PreviewId): Promise<PreviewRow | undefined> {
  const [row] = await db
    .update(preview)
    .set({ state: "closed", paused: false, updatedAt: new Date() })
    .where(eq(preview.id, id))
    .returning();
  return row;
}
