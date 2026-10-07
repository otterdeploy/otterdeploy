ALTER TABLE "service_resource" ADD COLUMN "image_builder" text;--> statement-breakpoint
-- Backfill what is certain: a service pinned to Railpack was built by it. An
-- `auto` service is learned on its next build.
UPDATE "service_resource" SET "image_builder" = 'railpack' WHERE "source" IN ('git', 'upload') AND "build_config"->>'builder' = 'railpack' AND "image" <> 'pending:initial';
