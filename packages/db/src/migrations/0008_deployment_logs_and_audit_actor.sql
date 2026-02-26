ALTER TABLE "deployment" ADD COLUMN IF NOT EXISTS "log_path" text;
ALTER TABLE "deployment" ADD COLUMN IF NOT EXISTS "log_server_id" text;
ALTER TABLE "deployment" ADD COLUMN IF NOT EXISTS "finished_at" timestamp;
ALTER TABLE "deployment" ADD COLUMN IF NOT EXISTS "error_message" text;

ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "actor_type" text;
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "actor_user_id" text;
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "actor_label" text;

UPDATE "audit_log"
SET
  "actor_type" = CASE
    WHEN "actor_type" IS NOT NULL THEN "actor_type"
    WHEN "user_id" IS NULL THEN 'system'
    ELSE 'user'
  END,
  "actor_user_id" = CASE
    WHEN "actor_user_id" IS NOT NULL THEN "actor_user_id"
    ELSE "user_id"
  END,
  "actor_label" = CASE
    WHEN "actor_label" IS NOT NULL THEN "actor_label"
    WHEN "user_id" IS NULL THEN 'system'
    ELSE 'user'
  END;

ALTER TABLE "audit_log" ALTER COLUMN "actor_type" SET DEFAULT 'user';
ALTER TABLE "audit_log" ALTER COLUMN "actor_type" SET NOT NULL;
ALTER TABLE "audit_log" ALTER COLUMN "actor_label" SET DEFAULT 'user';
ALTER TABLE "audit_log" ALTER COLUMN "actor_label" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audit_log_actor_user_id_user_id_fk'
  ) THEN
    ALTER TABLE "audit_log"
      ADD CONSTRAINT "audit_log_actor_user_id_user_id_fk"
      FOREIGN KEY ("actor_user_id")
      REFERENCES "public"."user"("id")
      ON DELETE set null
      ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audit_log_actor_type_check'
  ) THEN
    ALTER TABLE "audit_log"
      ADD CONSTRAINT "audit_log_actor_type_check"
      CHECK ("actor_type" in ('user', 'system'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "audit_log_actor_user_idx" ON "audit_log" USING btree ("actor_user_id");
CREATE INDEX IF NOT EXISTS "audit_log_actor_type_idx" ON "audit_log" USING btree ("actor_type");
