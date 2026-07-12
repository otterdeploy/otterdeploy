ALTER TABLE "preview" ADD COLUMN "paused" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- Backfill: pre-existing open previews had NULL auto_teardown_at, which now
-- reads as a keep-alive pin. Give them the default 72h idle window so idle GC
-- applies (operators who want them pinned can re-pin from the panel).
UPDATE "preview" SET "auto_teardown_at" = now() + interval '72 hours'
WHERE "state" = 'active' AND "auto_teardown_at" IS NULL;
