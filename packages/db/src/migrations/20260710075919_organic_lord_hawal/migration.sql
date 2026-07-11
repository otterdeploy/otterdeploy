CREATE TYPE "custom_certificate_install_state" AS ENUM('pending', 'installed', 'error');--> statement-breakpoint
CREATE TYPE "inbound_endpoint_action" AS ENUM('redeploy', 'none');--> statement-breakpoint
CREATE TYPE "inbound_endpoint_status" AS ENUM('active', 'paused');--> statement-breakpoint
CREATE TYPE "webhook_status" AS ENUM('active', 'paused');--> statement-breakpoint
CREATE TABLE "custom_certificate" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"hostname" text NOT NULL,
	"cert_pem" text NOT NULL,
	"key_ciphertext" text NOT NULL,
	"issuer" text,
	"subject" text,
	"serial" text,
	"sans" jsonb DEFAULT '[]' NOT NULL,
	"not_before" timestamp NOT NULL,
	"not_after" timestamp NOT NULL,
	"fingerprint256" text NOT NULL,
	"key_alg" text,
	"install_state" "custom_certificate_install_state" DEFAULT 'pending'::"custom_certificate_install_state" NOT NULL,
	"install_error" text,
	"uploaded_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trusted_ca" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"pem" text NOT NULL,
	"subject" text,
	"fingerprint256" text NOT NULL,
	"not_after" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbound_endpoint" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"token" text NOT NULL,
	"encrypted_secret" text NOT NULL,
	"action" "inbound_endpoint_action" DEFAULT 'redeploy'::"inbound_endpoint_action" NOT NULL,
	"resource_id" text,
	"ip_allowlist" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_invoked_at" timestamp,
	"status" "inbound_endpoint_status" DEFAULT 'active'::"inbound_endpoint_status" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"url" text NOT NULL,
	"encrypted_secret" text NOT NULL,
	"events" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "webhook_status" DEFAULT 'active'::"webhook_status" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_delivery" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"webhook_id" text NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb DEFAULT '{}' NOT NULL,
	"status_code" integer,
	"ok" boolean NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "backup" ADD COLUMN "volume_name" text;--> statement-breakpoint
ALTER TABLE "service_resource" ADD COLUMN "paused_replicas" integer;--> statement-breakpoint
ALTER TABLE "backup_schedule" DROP COLUMN "pitr";--> statement-breakpoint
ALTER TABLE "backup_schedule" DROP COLUMN "notify_channel";--> statement-breakpoint
ALTER TABLE "backup" ALTER COLUMN "resource_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "custom_certificate_organization_id_idx" ON "custom_certificate" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_certificate_org_hostname_unique" ON "custom_certificate" ("organization_id","hostname");--> statement-breakpoint
CREATE INDEX "trusted_ca_organization_id_idx" ON "trusted_ca" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trusted_ca_org_fingerprint_unique" ON "trusted_ca" ("organization_id","fingerprint256");--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_endpoint_token_idx" ON "inbound_endpoint" ("token");--> statement-breakpoint
CREATE INDEX "inbound_endpoint_org_idx" ON "inbound_endpoint" ("organization_id");--> statement-breakpoint
CREATE INDEX "webhook_org_idx" ON "webhook" ("organization_id");--> statement-breakpoint
CREATE INDEX "webhook_delivery_webhook_created_idx" ON "webhook_delivery" ("webhook_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_delivery_org_created_idx" ON "webhook_delivery" ("organization_id","created_at");--> statement-breakpoint
ALTER TABLE "custom_certificate" ADD CONSTRAINT "custom_certificate_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "custom_certificate" ADD CONSTRAINT "custom_certificate_uploaded_by_user_id_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "trusted_ca" ADD CONSTRAINT "trusted_ca_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "inbound_endpoint" ADD CONSTRAINT "inbound_endpoint_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "inbound_endpoint" ADD CONSTRAINT "inbound_endpoint_resource_id_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resource"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "webhook" ADD CONSTRAINT "webhook_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_webhook_id_webhook_id_fkey" FOREIGN KEY ("webhook_id") REFERENCES "webhook"("id") ON DELETE CASCADE;