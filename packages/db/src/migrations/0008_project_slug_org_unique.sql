ALTER TABLE "project" DROP CONSTRAINT "project_slug_unique";--> statement-breakpoint
DROP INDEX "project_slug_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "project_org_slug_unique" ON "project" USING btree ("organization_id","slug");