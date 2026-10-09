-- Who may claim a standalone environment, and a
-- foreign key on the project's main-environment pointer.
--
-- 1. environment.claimable_by_organization_id. A standalone environment
--    (project_id NULL, made by env.create ahead of project.create) carried
--    nothing tying it to an organization, so project.create in ANY org could
--    claim it by id. The column records the creating org; project.create only
--    claims a row whose column matches the caller's org, and clears it on the
--    claim (CHECK below: a claimed row never carries it). Existing standalone
--    rows get NULL, which no org can claim: their creator is unknowable, and
--    they are leftovers of an onboarding that never finished (the web client
--    claims its standalone row immediately). They are kept, not deleted.
--
-- 2. project.environment_id gets a composite foreign key to
--    environment(project_id, id), so the main pointer names an environment that
--    exists AND is this project's own. Pointers that already break that rule
--    are repaired FIRST, or the constraint cannot be added, the same way
--    20261007184825_resource_environment_in_project repairs resources:
--
--    * the environment no longer exists anywhere: it is recreated under THAT
--      id, in the project, named "Recovered environment". The pointer does not
--      change, and anything else that still carries the id lines up again.
--      (When resources pointed at it, 20261007184825 has already done this.)
--    * the environment exists but in another project, or is still standalone:
--      that row is someone else's and is left alone. A fresh "Recovered
--      environment" is minted in the project and the pointer moves to it (or
--      to the one 20261007184825 already recovered for the same pair).
--
--    Nothing is deleted. A NULL pointer (main environment deleted through
--    env.delete, which clears it) is valid and untouched. Recovered
--    environments are not protected, matching 20261007184825: the repair must
--    not change who can reach anything.
--
-- On a clean database every repair statement below is a no-op.
DO $$
DECLARE
  dangling_count integer;
  dangling_list text;
  unclaimable_count integer;
BEGIN
  SELECT count(*), string_agg(p.id || ' (' || p.slug || ', environment ' || p.environment_id || ')', '; ')
    INTO dangling_count, dangling_list
  FROM "project" p
  WHERE p.environment_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "environment" e
      WHERE e.id = p.environment_id AND e.project_id = p.id
    );
  IF dangling_count > 0 THEN
    RAISE NOTICE 'project_main_environment_in_project: % project(s) point at a main environment outside the project; giving each a recovered environment: %',
      dangling_count, dangling_list;
  END IF;
  SELECT count(*) INTO unclaimable_count FROM "environment" WHERE project_id IS NULL;
  IF unclaimable_count > 0 THEN
    RAISE NOTICE 'project_main_environment_in_project: % standalone environment(s) predate claim ownership and can no longer be claimed by project.create; they are kept as they are',
      unclaimable_count;
  END IF;
END $$;--> statement-breakpoint
INSERT INTO "environment" ("id", "project_id", "name", "slug", "protected")
SELECT
  CASE
    WHEN EXISTS (SELECT 1 FROM "environment" e WHERE e.id = p.environment_id)
      -- Two projects pointing at the same lost id: the first gets it back,
      -- the rest mint their own, since an environment has one project.
      OR EXISTS (
        SELECT 1 FROM "project" q
        WHERE q.environment_id = p.environment_id AND q.id < p.id
      )
      THEN 'env_' || replace(gen_random_uuid()::text, '-', '')
    ELSE p.environment_id
  END,
  p.id,
  'Recovered environment',
  'recovered-' || substr(md5(p.id || '/' || p.environment_id), 1, 12),
  false
FROM "project" p
WHERE p.environment_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "environment" e
    WHERE e.id = p.environment_id AND e.project_id = p.id
  )
-- 20261007184825 may already have recovered this very (project, environment
-- id) pair for the project's resources, under the same slug. Then the project
-- simply points at that one: its main resources and its pointer agree again.
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "project" p
SET "environment_id" = e.id
FROM "environment" e
WHERE e.project_id = p.id
  AND e.slug = 'recovered-' || substr(md5(p.id || '/' || p.environment_id), 1, 12)
  AND p.environment_id <> e.id
  AND NOT EXISTS (
    SELECT 1 FROM "environment" own
    WHERE own.id = p.environment_id AND own.project_id = p.id
  );--> statement-breakpoint
ALTER TABLE "environment" ADD COLUMN "claimable_by_organization_id" text;--> statement-breakpoint
ALTER TABLE "environment" ADD CONSTRAINT "environment_claimable_by_organization_id_organization_id_fkey" FOREIGN KEY ("claimable_by_organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "environment" ADD CONSTRAINT "environment_claimable_only_while_standalone" CHECK ("project_id" IS NULL OR "claimable_by_organization_id" IS NULL);--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_main_environment_in_project_fk" FOREIGN KEY ("id","environment_id") REFERENCES "environment"("project_id","id");
