-- Project slugs become unique across ALL organizations.
--
-- The slug alone names a project's runtime objects on the shared swarm:
-- services `od-<slug>-<service>`, the overlay network `<prefix><slug>`, and
-- volumes. None carry the organization, so two orgs that each own a project
-- `shop` deploy into the SAME services, network and volumes. Until now the
-- database only enforced (organization_id, slug).
--
-- An existing install can already hold cross-org duplicates. Resolution, per
-- duplicated slug:
--
--   1. One holder KEEPS the slug: a project that has resources wins over one
--      that has none, then the oldest (created_at, then id). Deterministic.
--   2. Every other holder WITHOUT resources is renamed to
--      `<slug, cut to 41 chars>-<last 6 chars of its id>` (<= 48, a valid
--      slug). It has no runtime objects (services, networks, volumes and
--      hostnames only exist for resources), so nothing on the swarm is
--      renamed; only its URL slug changes, and old bookmarks to it stop
--      resolving.
--   3. If a duplicate is still left after that, i.e. TWO OR MORE holders have
--      resources, the migration REFUSES: it raises, the transaction rolls
--      back (nothing above is applied), and the server does not start. The
--      error lists every holder.
--
-- Why refuse instead of renaming a project that has resources: a slug rename
-- does not move its runtime objects atomically. Some names are stored at
-- create (service_resource.service_name, database_resource.service_name and
-- volume_name), others are recomputed from the slug on every deploy (compose
-- services `od-<slug>-<stack>-<key>`, the project network, the volume of a
-- database created before volume_name was stored). Renaming in SQL splits a
-- running project across old and new names: its next deploy puts services on
-- a network its databases are not on, and an older database comes up on a
-- fresh, EMPTY volume. And because the two projects already share those
-- objects, which tenant owns the `shop` services right now is a question only the
-- operator can answer.
--
-- Operator fix for a refusal: for every holder except the one that should
-- keep the slug, either delete its resources, or (accepting that its runtime
-- objects are recreated under the new name and its old ones must be removed
-- by hand) give it a new slug with the previous server version or psql:
--   UPDATE "project" SET "slug" = '<new-slug>' WHERE "id" = '<project id>';
-- then start the server again; the migration re-runs from the top.
WITH "holder" AS (
  SELECT
    p."id",
    p."slug",
    EXISTS (SELECT 1 FROM "resource" r WHERE r."project_id" = p."id") AS "has_resources",
    row_number() OVER (
      PARTITION BY p."slug"
      ORDER BY
        EXISTS (SELECT 1 FROM "resource" r WHERE r."project_id" = p."id") DESC,
        p."created_at",
        p."id"
    ) AS "rank"
  FROM "project" p
  WHERE p."slug" IN (SELECT "slug" FROM "project" GROUP BY "slug" HAVING count(*) > 1)
)
UPDATE "project" p
SET "slug" = rtrim(left(h."slug", 41), '-') || '-' || right(h."id", 6),
    "updated_at" = now()
FROM "holder" h
WHERE p."id" = h."id"
  AND h."rank" > 1
  AND NOT h."has_resources";--> statement-breakpoint
DO $$
DECLARE
  conflicts text;
BEGIN
  SELECT string_agg(
    format('slug %L: project %s (organization %s, created %s)', p."slug", p."id", p."organization_id", p."created_at"),
    '; ' ORDER BY p."slug", p."created_at", p."id"
  )
  INTO conflicts
  FROM "project" p
  WHERE p."slug" IN (SELECT "slug" FROM "project" GROUP BY "slug" HAVING count(*) > 1);

  IF conflicts IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'unique_violation',
      MESSAGE = 'otterdeploy migration global_project_slugs refused: project slugs must be unique across all organizations, and these projects in different organizations share a slug while each has resources, so they already share swarm services, networks and volumes: ' || conflicts || '. Nothing was changed. For each listed slug pick the one project that keeps it; for every other project listed with that slug, delete its resources or give it a new slug (UPDATE "project" SET "slug" = ''<new-slug>'' WHERE "id" = ''<project id>''; its runtime objects are recreated under the new name on its next deploy and the old ones must be removed by hand), then restart the server. See packages/db/src/migrations/20261006191815_global_project_slugs/migration.sql.';
  END IF;
END $$;--> statement-breakpoint
DROP INDEX "project_org_slug_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "project_slug_unique" ON "project" ("slug");
