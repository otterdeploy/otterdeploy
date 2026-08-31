-- Strip the project prefix from default environment slugs (od-asc.7).
--
-- `project.create` used to mint the default environment as
-- `<projectSlug>-production` while the other two creation paths (web
-- onboarding via `env.create`, and the create dialog) both wrote a bare
-- `production`. Same concept, three code paths, two spellings — so
-- `?env=storefront-production` sat next to `?env=staging` in the same
-- project's URLs, and every `slug = 'production'` lookup downstream silently
-- missed the prefixed rows.
--
-- The mint was fixed forward-only (routers/project/queries/project.ts), which
-- left every project created before it carrying the old spelling. This is the
-- repair `packages/db/package.json`'s `db:normalize-environment-slugs` entry
-- has always named and never had.
--
-- SAFETY: `environment_project_slug_unique` is (project_id, slug). A project
-- that already owns a bare `production` alongside a prefixed one would
-- collide, so those are SKIPPED rather than failing the run, and reported
-- below for a human. They are the only case where the rename is ambiguous.
--
-- NOTE FOR OPERATORS: this changes the `?env=` value in URLs for the affected
-- environment. Bookmarks pointing at the prefixed slug stop resolving — which
-- is the same brokenness the `slug = 'production'` lookups already had, now
-- moved somewhere visible.
--
-- Idempotent: a second run matches nothing.

BEGIN;

UPDATE "environment" AS e
SET "slug" = 'production'
FROM "project" AS p
WHERE e."project_id" = p."id"
  AND e."slug" = p."slug" || '-production'
  AND NOT EXISTS (
    SELECT 1
    FROM "environment" AS conflict
    WHERE conflict."project_id" = e."project_id"
      AND conflict."slug" = 'production'
  );

COMMIT;

-- What is left, and why. Empty is the expected outcome.
SELECT e."id", e."project_id", e."slug",
       'project already has a bare "production" environment' AS reason
FROM "environment" AS e
JOIN "project" AS p ON p."id" = e."project_id"
WHERE e."slug" = p."slug" || '-production'
ORDER BY e."project_id";
