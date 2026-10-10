-- Where an imported project came from (`coolify:<project uuid>`), so
-- re-running a platform import recognises what it already imported instead
-- of creating a `-2` copy. NULL for projects created here; unique per org.
ALTER TABLE "project" ADD COLUMN "imported_from" text;--> statement-breakpoint
CREATE UNIQUE INDEX "project_imported_from_unique" ON "project" ("organization_id","imported_from");