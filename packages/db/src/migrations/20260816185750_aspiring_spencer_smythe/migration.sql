CREATE TYPE "vault_provider_kind" AS ENUM('hashicorp', 'infisical', 'doppler');--> statement-breakpoint
CREATE TYPE "vault_provider_status" AS ENUM('unverified', 'connected', 'error');--> statement-breakpoint
CREATE TABLE "vault_provider" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" "vault_provider_kind" NOT NULL,
	"config_json" jsonb DEFAULT '{}' NOT NULL,
	"credential_ciphertext" text NOT NULL,
	"status" "vault_provider_status" DEFAULT 'unverified'::"vault_provider_status" NOT NULL,
	"last_verified_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "service_resource" ADD COLUMN "extra_networks" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "server" ADD COLUMN "build_lane" text;--> statement-breakpoint
CREATE UNIQUE INDEX "vault_provider_org_name_unique" ON "vault_provider" ("organization_id","name");--> statement-breakpoint
ALTER TABLE "vault_provider" ADD CONSTRAINT "vault_provider_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;