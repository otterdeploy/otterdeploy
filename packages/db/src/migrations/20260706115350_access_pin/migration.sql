CREATE TABLE "server_health_sample" (
	"server_id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"hostname" text,
	"payload" jsonb NOT NULL,
	"sampled_at" timestamp NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proxy_route" ADD COLUMN "access_pin_hash" text;--> statement-breakpoint
CREATE INDEX "server_health_sample_org_idx" ON "server_health_sample" ("organization_id");--> statement-breakpoint
ALTER TABLE "server_health_sample" ADD CONSTRAINT "server_health_sample_server_id_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "server"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "server_health_sample" ADD CONSTRAINT "server_health_sample_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;