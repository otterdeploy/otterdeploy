ALTER TABLE "platform_settings" ADD COLUMN "bootstrap_completed_at" timestamp;--> statement-breakpoint
-- Any account proves this is an upgraded, already-bootstrapped installation.
-- Upsert because very old databases may not have created the singleton row yet.
INSERT INTO "platform_settings" ("id", "bootstrap_completed_at")
SELECT 'platform', now()
WHERE EXISTS (SELECT 1 FROM "user")
ON CONFLICT ("id") DO UPDATE
SET "bootstrap_completed_at" = COALESCE(
  "platform_settings"."bootstrap_completed_at",
  EXCLUDED."bootstrap_completed_at"
);
