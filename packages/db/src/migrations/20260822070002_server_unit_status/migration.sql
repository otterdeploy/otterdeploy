CREATE TABLE "server_unit" (
	"server_id" text,
	"organization_id" text NOT NULL,
	"unit_name" text,
	"active_state" text NOT NULL,
	"sub_state" text NOT NULL,
	"cpu_pct" double precision DEFAULT 0 NOT NULL,
	"mem_bytes" bigint,
	"mem_peak_bytes" bigint,
	"restart_count" integer DEFAULT 0 NOT NULL,
	"active_enter_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "server_unit_pkey" PRIMARY KEY("server_id","unit_name")
);
--> statement-breakpoint
CREATE INDEX "server_unit_org_idx" ON "server_unit" ("organization_id");--> statement-breakpoint
CREATE INDEX "server_unit_updated_at_idx" ON "server_unit" ("updated_at");--> statement-breakpoint
ALTER TABLE "server_unit" ADD CONSTRAINT "server_unit_server_id_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "server"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "server_unit" ADD CONSTRAINT "server_unit_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;