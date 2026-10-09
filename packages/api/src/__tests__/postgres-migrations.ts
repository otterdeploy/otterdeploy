/**
 * Upgrade-path helpers for the `*.postgres.test.ts` suite: a fresh database
 * migrated up to just BEFORE a given migration, so a test can seed the rows an
 * existing install may hold and then apply the rest of the migration set on
 * top with drizzle's migrator, exactly as server boot does.
 */
import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/src/migrations", import.meta.url));

export const short = (): string => randomUUID().replace(/-/g, "").slice(0, 12);

/** The server the suite's global setup was pointed at (see
 *  vitest.postgres.setup.ts, which refuses to start without it). */
function adminUrl(): string {
  /* oxlint-disable-next-line node/no-process-env -- test env boundary: the disposable server the postgres suite runs against */
  const url = process.env.INTEGRATION_POSTGRES_URL;
  if (!url) throw new Error("INTEGRATION_POSTGRES_URL is not set");
  return url;
}

/** Every migration folder strictly before `name`, copied verbatim into a temp
 *  dir. drizzle's migrator tracks applied migrations by folder name, so the
 *  full directory applied afterwards resumes exactly where this one stopped. */
function migrationsBefore(name: string): string {
  const all = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  const cutoff = all.indexOf(name);
  if (cutoff === -1) throw new Error(`migration folder ${name} not found`);
  const dir = mkdtempSync(join(tmpdir(), "otterdeploy-migrations-"));
  for (const folder of all.slice(0, cutoff)) {
    cpSync(join(MIGRATIONS_DIR, folder), join(dir, folder), { recursive: true });
  }
  return dir;
}

export async function applyMigrations(url: string, migrationsFolder: string): Promise<void> {
  const client = new SQL({ url, max: 1 });
  try {
    await migrate(drizzle({ client }), { migrationsFolder });
  } finally {
    await client.close();
  }
}

export type Cleanups = Array<() => Promise<void> | void>;

/** A throwaway database at the revision just before `migration`. Everything
 *  it creates is registered on `cleanups`, to be run in reverse afterwards. */
export async function installBefore(
  migration: string,
  cleanups: Cleanups,
): Promise<{ sql: SQL; url: string }> {
  const name = `upgrade_${short()}`;
  const admin = new SQL({ url: adminUrl(), max: 1 });
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  await admin.close();
  cleanups.push(async () => {
    const drop = new SQL({ url: adminUrl(), max: 1 });
    await drop.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await drop.close();
  });
  const url = new URL(adminUrl());
  url.pathname = `/${name}`;

  const before = migrationsBefore(migration);
  cleanups.push(() => rmSync(before, { recursive: true, force: true }));
  await applyMigrations(url.toString(), before);

  const sql = new SQL({ url: url.toString(), max: 2 });
  cleanups.push(() => sql.close());
  return { sql, url: url.toString() };
}
