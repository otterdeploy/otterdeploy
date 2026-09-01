/**
 * `server.stats` names projects by plain-string slug; the project routes take
 * the branded `Slug<"prj">`. Re-brand through the shared schema (the same
 * boundary the header nav uses) rather than asserting; a slug the schema
 * rejects renders as text instead of a link that would 404.
 */
import { ID_PREFIX, zSlug, type Slug } from "@otterdeploy/shared/id";

const projectSlug = zSlug(ID_PREFIX.project);

export function toProjectSlug(slug: string): Slug<typeof ID_PREFIX.project> | null {
  const parsed = projectSlug.safeParse(slug);
  return parsed.success ? parsed.data : null;
}
