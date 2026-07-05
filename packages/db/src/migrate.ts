import { env } from "@otterdeploy/env/server";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import { fileURLToPath } from "node:url";

import { db } from "./client";

/**
 * Resolve the migrations directory. In dev this module sits at
 * `packages/db/src/migrate.ts`, so `./migrations` is its sibling. In the
 * published server image the code is bundled, so the operator points
 * `DB_MIGRATIONS_DIR` at the copied-in folder (the Dockerfile sets it to the
 * `packages/db/src/migrations` path inside the image).
 */
function migrationsFolder(): string {
  if (env.DB_MIGRATIONS_DIR) return env.DB_MIGRATIONS_DIR;
  return fileURLToPath(new URL("./migrations", import.meta.url));
}

/**
 * Apply any pending migrations programmatically (drizzle-orm's migrator — no
 * drizzle-kit CLI at runtime). Tracked in `drizzle.__drizzle_migrations`, so it
 * is idempotent: a no-op when the DB is already up to date. Throws on failure
 * so the caller (server boot) can refuse to start against a half-migrated
 * schema.
 */
export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder: migrationsFolder() });
}
