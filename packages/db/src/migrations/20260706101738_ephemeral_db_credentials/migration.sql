CREATE TABLE "database_ephemeral_credential" (
	"id" text PRIMARY KEY,
	"resource_id" text NOT NULL,
	"role_name" text NOT NULL,
	"scope" text DEFAULT 'read-only' NOT NULL,
	"label" text,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "database_ephemeral_credential_role_unique" ON "database_ephemeral_credential" ("role_name");--> statement-breakpoint
CREATE INDEX "database_ephemeral_credential_resource_idx" ON "database_ephemeral_credential" ("resource_id");--> statement-breakpoint
CREATE INDEX "database_ephemeral_credential_expires_idx" ON "database_ephemeral_credential" ("expires_at");--> statement-breakpoint
ALTER TABLE "database_ephemeral_credential" ADD CONSTRAINT "database_ephemeral_credential_resource_id_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resource"("id") ON DELETE CASCADE;