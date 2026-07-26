CREATE TABLE "node_enrollment" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"role" "server_role" NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"created_by_user_id" text,
	"expires_at" timestamp NOT NULL,
	"redeemed_at" timestamp,
	"completed_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "swarm_join_rotation" (
	"role" "server_role" PRIMARY KEY,
	"required_at" timestamp NOT NULL,
	"completed_at" timestamp,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "node_enrollment_org_idx" ON "node_enrollment" ("organization_id");--> statement-breakpoint
CREATE INDEX "node_enrollment_expiry_idx" ON "node_enrollment" ("expires_at");--> statement-breakpoint
ALTER TABLE "node_enrollment" ADD CONSTRAINT "node_enrollment_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "node_enrollment" ADD CONSTRAINT "node_enrollment_created_by_user_id_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL;