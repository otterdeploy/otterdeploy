-- rabbitmq / minio / meilisearch moved to the templates catalog and are no
-- longer valid database engines. Delete any existing database resources of
-- those engines BEFORE narrowing the enum — otherwise recreating the type below
-- fails casting 'rabbitmq'/'minio'/'meilisearch' to the new enum. Runs while the
-- enum still holds all 8 values. Deleting the parent resource cascades to
-- database_resource + deployments (FK onDelete: cascade). Any live swarm
-- containers for these become unmanaged (accepted: they are no longer engines).
DELETE FROM "resource" WHERE "id" IN (
  SELECT "resource_id" FROM "database_resource"
  WHERE "engine" IN ('rabbitmq', 'minio', 'meilisearch')
);--> statement-breakpoint
ALTER TABLE "database_resource" ALTER COLUMN "engine" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "database_resource" ALTER COLUMN "engine" DROP DEFAULT;--> statement-breakpoint
DROP TYPE "database_engine";--> statement-breakpoint
CREATE TYPE "database_engine" AS ENUM('postgres', 'redis', 'mariadb', 'mongodb', 'clickhouse');--> statement-breakpoint
ALTER TABLE "database_resource" ALTER COLUMN "engine" SET DATA TYPE "database_engine" USING "engine"::"database_engine";--> statement-breakpoint
ALTER TABLE "database_resource" ALTER COLUMN "engine" SET DEFAULT 'postgres'::"database_engine";