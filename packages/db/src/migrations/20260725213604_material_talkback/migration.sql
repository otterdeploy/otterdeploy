ALTER TABLE "two_factor" ADD COLUMN "verified" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "is_install_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Existing installations previously derived host authority from organization
-- roles. Preserve one operator without carrying that unsafe coupling forward:
-- the oldest account is the deterministic installation owner.
UPDATE "user"
SET "is_install_admin" = true
WHERE "id" = (
  SELECT "id"
  FROM "user"
  ORDER BY "created_at" ASC, "id" ASC
  LIMIT 1
);--> statement-breakpoint
CREATE UNIQUE INDEX "user_single_install_admin_idx" ON "user" ("is_install_admin") WHERE "is_install_admin" = true;
