ALTER TABLE "git_provider" ADD COLUMN "host" text DEFAULT 'github.com' NOT NULL;--> statement-breakpoint
ALTER TABLE "git_provider" ADD COLUMN "external_app_id" text;--> statement-breakpoint
ALTER TABLE "git_provider" ADD COLUMN "app_slug" text;--> statement-breakpoint
ALTER TABLE "git_provider" ADD COLUMN "client_id" text;--> statement-breakpoint
ALTER TABLE "git_provider" ADD COLUMN "client_secret_ciphertext" text;--> statement-breakpoint
ALTER TABLE "git_provider" ADD COLUMN "webhook_secret_ciphertext" text;--> statement-breakpoint
ALTER TABLE "git_provider" ADD COLUMN "private_key_pem_ciphertext" text;--> statement-breakpoint
CREATE INDEX "git_provider_external_app_id_idx" ON "git_provider" USING btree ("external_app_id");