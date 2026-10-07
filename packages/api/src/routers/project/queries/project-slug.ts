/**
 * Install-wide project slug lookups. Kept apart from ./project.ts,
 * which stays row-level project/environment CRUD.
 */
import { db } from "@otterdeploy/db";
import { project } from "@otterdeploy/db/schema/project";
import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { eq, inArray } from "drizzle-orm";

/**
 * Is `slug` held by ANY project on this install, in any organization?
 *
 * Project slugs are globally unique (`project_slug_unique`): the
 * slug alone names the project's runtime objects on the shared swarm
 * (`od-<slug>-<service>`, the project network, volumes), none of which carry
 * the organization. Two orgs sharing a slug would share those objects.
 */
export async function isProjectSlugTaken(slug: string): Promise<boolean> {
  const [row] = await db
    .select({ id: project.id })
    .from(project)
    .where(eq(project.slug, slug))
    .limit(1);
  return row !== undefined;
}

/** Longest slug the project contracts accept (`.slugify().min(2).max(48)`). */
const PROJECT_SLUG_MAX = 48;

/**
 * A free alternative to a taken project slug: `<slug>-2`, `<slug>-3`, …,
 * truncating the base so the result still fits the 48-char limit. One query
 * checks the whole candidate run; the cuid fallback only triggers when all of
 * them are taken, which no real install reaches.
 */
export async function suggestFreeProjectSlug(slug: string): Promise<string> {
  const candidates = Array.from({ length: 99 }, (_, i) => {
    const suffix = `-${i + 2}`;
    return `${slug.slice(0, PROJECT_SLUG_MAX - suffix.length).replace(/-+$/, "")}${suffix}`;
  });
  const taken = await db
    .select({ slug: project.slug })
    .from(project)
    .where(inArray(project.slug, candidates));
  const takenSet = new Set(taken.map((r) => r.slug));
  const free = candidates.find((c) => !takenSet.has(c));
  if (free) return free;
  const suffix = `-${createId(ID_PREFIX.project).slice(-6)}`;
  return `${slug.slice(0, PROJECT_SLUG_MAX - suffix.length).replace(/-+$/, "")}${suffix}`;
}
