-- Purge stale OLD-MODEL preview rows before the re-model DDL below. Previews
-- were environment-scoped (environment.kind='preview') before this migration;
-- left in place, an env-scoped resource row would duplicate its base name and
-- fail the new resource_project_name_base_unique partial index, and closed
-- preview env rows would linger as phantom user environments.
DELETE FROM "proxy_route" WHERE "environment_id" IS NOT NULL;--> statement-breakpoint
DELETE FROM "deployment" WHERE "environment_id" IS NOT NULL;--> statement-breakpoint
DELETE FROM "resource" WHERE "environment_id" IS NOT NULL;--> statement-breakpoint
DELETE FROM "service_env_var" WHERE "environment_id" IN (SELECT "id" FROM "environment" WHERE "kind" = 'preview');--> statement-breakpoint
DELETE FROM "project_env_var" WHERE "environment_id" IN (SELECT "id" FROM "environment" WHERE "kind" = 'preview');--> statement-breakpoint
DELETE FROM "environment" WHERE "kind" = 'preview';--> statement-breakpoint
CREATE TYPE "preview_state" AS ENUM('active', 'closed');--> statement-breakpoint
CREATE TABLE "preview" (
	"id" text PRIMARY KEY,
	"project_id" text NOT NULL,
	"git_repo_id" text NOT NULL,
	"pr_number" integer NOT NULL,
	"pr_node_id" text,
	"branch" text NOT NULL,
	"head_sha" text NOT NULL,
	"slug" text NOT NULL,
	"state" "preview_state" DEFAULT 'active'::"preview_state" NOT NULL,
	"auto_teardown_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proxy_route" DROP CONSTRAINT "proxy_route_environment_id_environment_id_fkey";--> statement-breakpoint
DROP INDEX "deployment_environment_id_idx";--> statement-breakpoint
DROP INDEX "resource_project_name_env_unique";--> statement-breakpoint
DROP INDEX "resource_environment_id_idx";--> statement-breakpoint
DROP INDEX "proxy_route_environment_id_idx";--> statement-breakpoint
DROP INDEX "environment_project_repo_pr_unique";--> statement-breakpoint
ALTER TABLE "database_resource" ADD COLUMN "preview_branching" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN "preview_id" text;--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "preview_id" text;--> statement-breakpoint
ALTER TABLE "proxy_route" ADD COLUMN "preview_id" text;--> statement-breakpoint
ALTER TABLE "deployment" DROP COLUMN "environment_id";--> statement-breakpoint
ALTER TABLE "resource" DROP COLUMN "environment_id";--> statement-breakpoint
ALTER TABLE "proxy_route" DROP COLUMN "environment_id";--> statement-breakpoint
ALTER TABLE "environment" DROP COLUMN "kind";--> statement-breakpoint
ALTER TABLE "environment" DROP COLUMN "state";--> statement-breakpoint
ALTER TABLE "environment" DROP COLUMN "base_environment_id";--> statement-breakpoint
ALTER TABLE "environment" DROP COLUMN "git_repo_id";--> statement-breakpoint
ALTER TABLE "environment" DROP COLUMN "git_ref";--> statement-breakpoint
ALTER TABLE "environment" DROP COLUMN "pull_request_number";--> statement-breakpoint
ALTER TABLE "environment" DROP COLUMN "pull_request_node_id";--> statement-breakpoint
ALTER TABLE "environment" DROP COLUMN "head_sha";--> statement-breakpoint
ALTER TABLE "environment" DROP COLUMN "auto_teardown_at";--> statement-breakpoint
-- IF EXISTS: this partial index's predicate references environment_id, so
-- Postgres already auto-dropped it with the DROP COLUMN above.
DROP INDEX IF EXISTS "resource_project_name_base_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "resource_project_name_base_unique" ON "resource" ("project_id","name") WHERE preview_id is null;--> statement-breakpoint
CREATE INDEX "deployment_preview_id_idx" ON "deployment" ("preview_id");--> statement-breakpoint
CREATE INDEX "preview_project_id_idx" ON "preview" ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "preview_project_repo_pr_unique" ON "preview" ("project_id","git_repo_id","pr_number");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_project_name_preview_unique" ON "resource" ("project_id","preview_id","name") WHERE preview_id is not null;--> statement-breakpoint
CREATE INDEX "resource_preview_id_idx" ON "resource" ("preview_id");--> statement-breakpoint
CREATE INDEX "proxy_route_preview_id_idx" ON "proxy_route" ("preview_id");--> statement-breakpoint
ALTER TABLE "preview" ADD CONSTRAINT "preview_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "proxy_route" ADD CONSTRAINT "proxy_route_preview_id_preview_id_fkey" FOREIGN KEY ("preview_id") REFERENCES "preview"("id") ON DELETE CASCADE;--> statement-breakpoint
DROP TYPE "environment_kind";--> statement-breakpoint
DROP TYPE "environment_state";