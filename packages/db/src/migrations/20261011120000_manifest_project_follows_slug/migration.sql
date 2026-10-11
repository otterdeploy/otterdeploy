-- A stored manifest names its project by slug, and a manifest save is now
-- refused unless that name matches the project it is saved to. Renames (and
-- the slug de-duplication in 20261006191815_global_project_slugs) changed
-- `project.slug` without touching the stored manifest, so bring every stored
-- manifest and applied snapshot in line with its project's current slug once.
-- From here on a rename carries the name along in the same write.
UPDATE "project"
SET "manifest" = jsonb_set("manifest", '{project}', to_jsonb("slug"))
WHERE jsonb_typeof("manifest") = 'object'
  AND "manifest"->>'project' IS DISTINCT FROM "slug";--> statement-breakpoint
UPDATE "project"
SET "last_applied_manifest" = jsonb_set("last_applied_manifest", '{project}', to_jsonb("slug"))
WHERE jsonb_typeof("last_applied_manifest") = 'object'
  AND "last_applied_manifest"->>'project' IS DISTINCT FROM "slug";
