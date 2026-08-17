/**
 * Drives the real drizzle-kit-generated migrations from packages/db against
 * a throwaway database, independent of the `@otterdeploy/db` singleton
 * client (which reads `DATABASE_URL` from `@otterdeploy/env/server` once, at
 * module load. Unsuitable for a suite that needs several isolated
 * databases in one process). Every helper here opens and closes its own
 * short-lived `bun:sql` connection instead.
 */
import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REAL_MIGRATIONS_DIR = fileURLToPath(
  new URL("../../packages/db/src/migrations", import.meta.url),
);

/** The two migrations added by od-5j8.1 (fix(auth): secure installation
 *  bootstrap, commit 6b6bf9cd): the `is_install_admin` column + backfill,
 *  then the `bootstrap_completed_at` marker + upgrade backfill. */
const BOOTSTRAP_MIGRATION_NAMES = [
  "20260725213604_material_talkback",
  "20260725214306_fearless_valkyrie",
] as const;

function allMigrationFolders(): string[] {
  return readdirSync(REAL_MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

/** Copies the given migration folders (by name, verbatim content) into a
 *  fresh temp directory. drizzle's migrator tracks "already applied" by
 *  folder NAME (see drizzle-orm/migrator.utils.ts `getMigrationsToRun`), so
 *  a folder copied here is interchangeable with the real one for that
 *  bookkeeping, running against a subset dir first and the full dir second
 *  correctly resumes from where the subset left off. */
function buildMigrationsDir(folderNames: readonly string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "otterdeploy-migrations-"));
  for (const name of folderNames) {
    cpSync(join(REAL_MIGRATIONS_DIR, name), join(dir, name), { recursive: true });
  }
  return dir;
}

/** All migration folders strictly before the bootstrap pair: the schema
 *  shape of an "existing install" that has never seen od-5j8.1. */
export function preBootstrapMigrationsDir(): string {
  const all = allMigrationFolders();
  const cutoff = all.indexOf(BOOTSTRAP_MIGRATION_NAMES[0]);
  if (cutoff === -1) {
    throw new Error(`bootstrap migration folder ${BOOTSTRAP_MIGRATION_NAMES[0]} not found`);
  }
  return buildMigrationsDir(all.slice(0, cutoff));
}

/** Pre-bootstrap folders plus exactly the two bootstrap migrations: i.e.
 *  "apply migrations up to the pre-bootstrap revision, then apply the
 *  bootstrap migrations" without pulling in any later, unrelated schema
 *  changes that may have landed since. */
export function upToBootstrapMigrationsDir(): string {
  const all = allMigrationFolders();
  const end = all.indexOf(BOOTSTRAP_MIGRATION_NAMES[1]);
  if (end === -1) {
    throw new Error(`bootstrap migration folder ${BOOTSTRAP_MIGRATION_NAMES[1]} not found`);
  }
  return buildMigrationsDir(all.slice(0, end + 1));
}

/** The full, real migrations directory (fresh-install path, everything up
 *  to and including the latest migration). */
export function allMigrationsDir(): string {
  return REAL_MIGRATIONS_DIR;
}

export async function applyMigrations(
  databaseUrl: string,
  migrationsFolder: string,
): Promise<void> {
  const client = new SQL({ url: databaseUrl, max: 1 });
  try {
    const db = drizzle({ client });
    await migrate(db, { migrationsFolder });
  } finally {
    await client.close();
  }
}

/** Removes a directory built by `buildMigrationsDir` (via the exported
 *  `preBootstrapMigrationsDir` / `upToBootstrapMigrationsDir`). Safe to call
 *  on `allMigrationsDir()`'s return value too. It's a no-op guard, not a
 *  destructive rm of the real source tree, because that path never matches
 *  the tmp-dir prefix this checks for. */
export function cleanupMigrationsDir(dir: string): void {
  if (dir.includes("otterdeploy-migrations-")) {
    rmSync(dir, { recursive: true, force: true });
  }
}
