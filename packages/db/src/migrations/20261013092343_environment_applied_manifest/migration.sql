-- What each environment last applied, recorded on the environment itself. The
-- project's single `last_applied_manifest` is written by whichever
-- environment applied last, so it cannot say what any OTHER environment runs.
ALTER TABLE "environment" ADD COLUMN "applied_manifest" jsonb;--> statement-breakpoint
ALTER TABLE "environment" ADD COLUMN "applied_manifest_resolved" jsonb;--> statement-breakpoint
-- A project with exactly one environment can only have been applied by that
-- environment, so its project-wide snapshot is that environment's own and is
-- carried over. A project with several environments starts empty: nothing in
-- the shared snapshot says which of them wrote it, and reading it as anyone's
-- is how a resource another environment applied turned into a pending delete.
-- Each environment records its own on its next apply.
UPDATE "environment" e
SET "applied_manifest" = p."last_applied_manifest",
    "applied_manifest_resolved" = p."last_applied_manifest"
FROM "project" p
WHERE e."id" = p."environment_id"
  AND jsonb_typeof(p."last_applied_manifest") = 'object'
  AND (SELECT count(*) FROM "environment" x WHERE x."project_id" = p."id") = 1;
