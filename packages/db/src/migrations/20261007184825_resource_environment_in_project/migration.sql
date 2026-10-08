-- resource.environment_id gets a foreign key, composite with
-- project_id, so a resource can only sit in an environment of its own project.
--
-- Rows that already break that rule are repaired FIRST, or the constraint
-- cannot be added. Such a row is "stranded": its environment_id names an
-- environment that is gone, or one that belongs to another project, so no
-- scoped read ever returns it. It is invisible in every list while its
-- container may still be running, and the operator cannot delete what the UI
-- will not show.
--
-- The repair gives each stranded (project, environment id) pair an
-- environment of its own in that project, named "Recovered environment", and
-- leaves the resource rows otherwise untouched: nothing is deleted, renamed or
-- moved into another environment's namespace.
--
--   * environment id that no longer exists anywhere: the environment is
--     recreated with THAT id, so the resource rows do not change at all. If it
--     was the project's main environment (project.environment_id still points
--     at it), main is whole again and keeps naming its containers exactly as
--     before, since main always renders as base. When resources of several
--     projects carry the same lost id, the first project (lowest id) gets it
--     back and the others are treated as below.
--   * environment id that exists but in another project (or unclaimed): that
--     row is someone else's and is left alone; a fresh environment is minted
--     in the resource's project and the stranded rows are pointed at it.
--
-- Deliberately NOT re-homed into main: a non-main resource carries the same
-- stored names as its main twin and differs only by the environment suffix at
-- deploy, so re-homing it would make its next deploy take production's
-- container name (the very collision lib/environment/runtime-scope.ts refuses).
-- A recovered environment has its own slug, so a later redeploy gets its own
-- suffix and can never land on production.
--
-- Recovered environments are not marked protected: the repair makes rows
-- visible again and must not change who can reach anything. The operator can
-- inspect the environment, then delete it (and its resources) from Settings.
--
-- On a clean database every statement below is a no-op apart from the two
-- constraints.
DO $$
DECLARE
  stranded_count integer;
  stranded_list text;
BEGIN
  SELECT count(*), string_agg(r.id || ' (' || r.name || ', environment ' || r.environment_id || ')', '; ')
    INTO stranded_count, stranded_list
  FROM "resource" r
  WHERE r.environment_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "environment" e
      WHERE e.id = r.environment_id AND e.project_id = r.project_id
    );
  IF stranded_count > 0 THEN
    RAISE NOTICE 'resource_environment_in_project: % resource row(s) reference an environment outside their project; moving them into a recovered environment: %',
      stranded_count, stranded_list;
  END IF;
END $$;--> statement-breakpoint
INSERT INTO "environment" ("id", "project_id", "name", "slug", "protected")
SELECT
  CASE
    WHEN EXISTS (SELECT 1 FROM "environment" e WHERE e.id = s.environment_id)
      -- Resources of two projects carrying the same lost id: the first project
      -- gets it back, the rest mint their own, since an environment has one
      -- project (reusing it twice would collide on the primary key).
      OR EXISTS (
        SELECT 1 FROM "resource" other
        WHERE other.environment_id = s.environment_id
          AND other.project_id < s.project_id
      )
      THEN 'env_' || replace(gen_random_uuid()::text, '-', '')
    ELSE s.environment_id
  END,
  s.project_id,
  'Recovered environment',
  'recovered-' || substr(md5(s.project_id || '/' || s.environment_id), 1, 12),
  false
FROM (
  SELECT DISTINCT r.project_id, r.environment_id
  FROM "resource" r
  WHERE r.environment_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "environment" e
      WHERE e.id = r.environment_id AND e.project_id = r.project_id
    )
) s;--> statement-breakpoint
UPDATE "resource" r
SET "environment_id" = e.id
FROM "environment" e
WHERE e.project_id = r.project_id
  AND e.slug = 'recovered-' || substr(md5(r.project_id || '/' || r.environment_id), 1, 12)
  AND r.environment_id <> e.id
  AND NOT EXISTS (
    SELECT 1 FROM "environment" own
    WHERE own.id = r.environment_id AND own.project_id = r.project_id
  );--> statement-breakpoint
ALTER TABLE "environment" ADD CONSTRAINT "environment_project_id_id_unique" UNIQUE("project_id","id");--> statement-breakpoint
ALTER TABLE "resource" ADD CONSTRAINT "resource_environment_in_project_fk" FOREIGN KEY ("project_id","environment_id") REFERENCES "environment"("project_id","id");
