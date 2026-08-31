CREATE TYPE "data_connection_access" AS ENUM('read-only', 'read-write');--> statement-breakpoint
CREATE TYPE "data_connection_engine" AS ENUM('postgres', 'mariadb');--> statement-breakpoint
CREATE TYPE "data_connection_environment" AS ENUM('production', 'other');--> statement-breakpoint
CREATE TYPE "data_connection_visibility" AS ENUM('org', 'private');--> statement-breakpoint
CREATE TABLE "data_connection" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"engine" "data_connection_engine" NOT NULL,
	"encrypted_url" text NOT NULL,
	"display_host" text NOT NULL,
	"display_database" text NOT NULL,
	"visibility" "data_connection_visibility" DEFAULT 'org'::"data_connection_visibility" NOT NULL,
	"environment" "data_connection_environment" DEFAULT 'other'::"data_connection_environment" NOT NULL,
	"default_access" "data_connection_access" DEFAULT 'read-only'::"data_connection_access" NOT NULL,
	"require_tls" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_connected_at" timestamp
);
--> statement-breakpoint
CREATE INDEX "data_connection_org_idx" ON "data_connection" ("organization_id");--> statement-breakpoint
CREATE INDEX "data_connection_creator_idx" ON "data_connection" ("created_by");--> statement-breakpoint
ALTER TABLE "data_connection" ADD CONSTRAINT "data_connection_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "data_connection" ADD CONSTRAINT "data_connection_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE SET NULL;