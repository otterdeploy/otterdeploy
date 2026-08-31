-- Attach resources that were written without an environment to their project's
-- main environment (od-6h0).
--
-- `resource.environment_id` is nullable and the read path treats null as the
-- project's main environment, so an orphan is still REACHABLE — that tolerance
-- is what kept a live database visible on 2026-08-10 (od-lqm). This closes the
-- other half: the rows should carry the environment they belong to, so the next
-- scoped query written without the null fallback does not lose them again.
--
-- The writes are fixed as of the same change: every `resource` insert now goes
-- through project/queries/new-resource-environment.ts, so nothing new lands
-- unscoped and this only has to run once, over the backlog.
--
-- SAFETY: a project may already hold an environment-scoped row with the same
-- name as an orphan (`postgres` in main AND an unscoped `postgres`). Attaching
-- the orphan would collide with resource_project_name_env_unique, so those are
-- SKIPPED rather than failing the whole run — they keep working through the
-- read-side null fallback and are reported below for a human to rename.
--
-- Idempotent: a second run matches nothing, because no orphan remains except
-- the deliberately-skipped collisions.

BEGIN;

UPDATE "resource" AS r
SET "environment_id" = p."environment_id"
FROM "project" AS p
WHERE r."project_id" = p."id"
  AND r."environment_id" IS NULL
  AND p."environment_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "resource" AS conflict
    WHERE conflict."project_id" = r."project_id"
      AND conflict."environment_id" = p."environment_id"
      AND conflict."name" = r."name"
  );

COMMIT;

-- What is left, and why. Empty is the expected outcome.
SELECT r."id", r."project_id", r."type", r."name",
       'name already taken in the project''s main environment' AS reason
FROM "resource" AS r
JOIN "project" AS p ON p."id" = r."project_id"
WHERE r."environment_id" IS NULL
  AND p."environment_id" IS NOT NULL
ORDER BY r."project_id", r."name";
