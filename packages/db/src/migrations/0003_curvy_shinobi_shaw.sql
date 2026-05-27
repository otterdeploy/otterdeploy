CREATE TYPE "public"."git_installation_account_type" AS ENUM('user', 'organization');--> statement-breakpoint
CREATE TYPE "public"."git_installation_repo_selection" AS ENUM('all', 'selected');--> statement-breakpoint
CREATE TYPE "public"."git_provider_kind" AS ENUM('github');--> statement-breakpoint
ALTER TYPE "public"."deployment_reason" ADD VALUE 'git-push';--> statement-breakpoint
CREATE TABLE "git_installation" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"installation_id" text NOT NULL,
	"account_login" text NOT NULL,
	"account_type" "git_installation_account_type" NOT NULL,
	"account_avatar_url" text,
	"repo_selection" "git_installation_repo_selection" NOT NULL,
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"suspended_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "git_provider" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" "git_provider_kind" NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "git_repo" (
	"id" text PRIMARY KEY NOT NULL,
	"installation_id" text,
	"provider_repo_id" text NOT NULL,
	"full_name" text NOT NULL,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"is_private" boolean DEFAULT true NOT NULL,
	"clone_url" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN "git_sha" text;--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN "git_ref" text;--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN "git_commit_message" text;--> statement-breakpoint
ALTER TABLE "deployment" ADD COLUMN "git_commit_author" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "git_repo_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "production_branch" text DEFAULT 'main' NOT NULL;--> statement-breakpoint
ALTER TABLE "git_installation" ADD CONSTRAINT "git_installation_provider_id_git_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."git_provider"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_provider" ADD CONSTRAINT "git_provider_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_repo" ADD CONSTRAINT "git_repo_installation_id_git_installation_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."git_installation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "git_installation_installation_id_unique" ON "git_installation" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX "git_installation_provider_id_idx" ON "git_installation" USING btree ("provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "git_provider_org_kind_unique" ON "git_provider" USING btree ("organization_id","kind");--> statement-breakpoint
CREATE INDEX "git_provider_organization_id_idx" ON "git_provider" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "git_repo_provider_repo_id_unique" ON "git_repo" USING btree ("provider_repo_id");--> statement-breakpoint
CREATE INDEX "git_repo_installation_id_idx" ON "git_repo" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX "git_repo_full_name_idx" ON "git_repo" USING btree ("full_name");--> statement-breakpoint
CREATE INDEX "project_git_repo_id_idx" ON "project" USING btree ("git_repo_id");