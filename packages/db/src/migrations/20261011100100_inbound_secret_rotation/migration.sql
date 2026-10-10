ALTER TABLE "inbound_endpoint" ADD COLUMN "previous_encrypted_secret" text;--> statement-breakpoint
ALTER TABLE "inbound_endpoint" ADD COLUMN "previous_secret_expires_at" timestamp;