CREATE TABLE "health_agent_credential" (
	"id" text PRIMARY KEY,
	"server_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"hostname" text NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"issued_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"last_seen_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "server" ADD COLUMN "host_fingerprint" text;--> statement-breakpoint
ALTER TABLE "server" ADD COLUMN "host_fingerprint_algo" text;--> statement-breakpoint
ALTER TABLE "server" ADD COLUMN "host_fingerprint_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "server" ADD COLUMN "host_fingerprint_pinned_at" timestamp;--> statement-breakpoint
CREATE INDEX "health_agent_credential_server_idx" ON "health_agent_credential" ("server_id");--> statement-breakpoint
CREATE INDEX "health_agent_credential_expiry_idx" ON "health_agent_credential" ("expires_at");--> statement-breakpoint
ALTER TABLE "health_agent_credential" ADD CONSTRAINT "health_agent_credential_server_id_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "server"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "health_agent_credential" ADD CONSTRAINT "health_agent_credential_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;