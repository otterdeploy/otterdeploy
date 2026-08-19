ALTER TABLE "service_resource" ADD COLUMN "compose_service" text;--> statement-breakpoint
-- Backfill: derive the compose key from the child's resource name, which
-- pickResourceName built as <stackName>-<composeKey> (a namesake child takes
-- the stack's own name). Fallback-suffixed names that match neither pattern
-- stay NULL and self-heal on the stack's next redeploy.
UPDATE "service_resource" sr
SET "compose_service" = CASE
  WHEN r."name" = sres."name" THEN r."name"
  WHEN r."name" LIKE sres."name" || '-%' THEN substring(r."name" from length(sres."name") + 2)
END
FROM "resource" r, "resource" sres
WHERE r."id" = sr."resource_id"
  AND sres."id" = sr."stack_id"
  AND sr."stack_id" IS NOT NULL;
