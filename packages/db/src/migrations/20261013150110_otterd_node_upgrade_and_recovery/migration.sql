ALTER TABLE "otterd_node" ADD COLUMN "upgrade_release" jsonb;--> statement-breakpoint
ALTER TABLE "otterd_node" ADD COLUMN "recovery_epoch" integer;--> statement-breakpoint
ALTER TABLE "otterd_node" ADD COLUMN "reenroll_certificate" jsonb;