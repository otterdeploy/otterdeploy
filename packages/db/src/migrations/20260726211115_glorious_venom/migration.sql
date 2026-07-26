CREATE TABLE "audit_chain_state" (
	"id" text PRIMARY KEY DEFAULT 'singleton',
	"last_hash" text,
	"last_row_id" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "prev_hash" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "hash" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "exported_at" timestamp;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_log_hash_idx" ON "audit_log" ("hash") WHERE "hash" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "audit_log_export_pending_idx" ON "audit_log" ("exported_at","created_at");