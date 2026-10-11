-- Who asked for a deployment (clicked Deploy, applied the manifest), kept
-- apart from the commit author: the author wrote the code, the trigger
-- shipped it. NULL for deploys nobody asked for by hand, and when the user
-- is later deleted.
ALTER TABLE "deployment" ADD COLUMN "triggered_by_user_id" text;--> statement-breakpoint
ALTER TABLE "deployment" ADD CONSTRAINT "deployment_triggered_by_user_id_user_id_fkey" FOREIGN KEY ("triggered_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL;