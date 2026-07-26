/**
 * od-5j8.1.1, property 5 — proves the od-5j8.1 bootstrap migrations
 * (packages/db/src/migrations/20260725213604_material_talkback +
 * 20260725214306_fearless_valkyrie) correctly UPGRADE an existing
 * installation: given a database that already has users (i.e. predates
 * od-5j8.1's `is_install_admin` column entirely), applying the migrations
 * must backfill the OLDEST existing user as install admin and mark the
 * install as already-bootstrapped — never touch the better-auth hook or the
 * `@otterdeploy/auth`/`@otterdeploy/db` singletons (deliberately: those read
 * `DATABASE_URL` once per process, which would conflict with
 * bootstrap-fresh's use of a different throwaway database in the same test
 * run). This file drives drizzle's migrator directly against its own
 * isolated connection instead — see test-infra/integration/migrations.ts.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { randomUUID } from "node:crypto";

import { applyMigrations, cleanupMigrationsDir, preBootstrapMigrationsDir, upToBootstrapMigrationsDir } from "./migrations";
import { integrationRunnable, type PostgresInstance, startPostgresInstance } from "./postgres-harness";

const canRun = integrationRunnable();
if (!canRun) {
  console.warn(
    "[integration] Skipping bootstrap-upgrade Postgres suite: no INTEGRATION_POSTGRES_URL and Docker is unavailable. " +
      "Start Docker locally, or set INTEGRATION_POSTGRES_URL to a running postgres:17 instance, to run this suite.",
  );
}

describe.skipIf(!canRun)("bootstrap (upgrade path) — migration backfill against Postgres 17", () => {
  let instance: PostgresInstance;
  let databaseUrl: string;
  let dropDb: () => Promise<void>;
  let sql: SQL;
  let preDir: string;
  let upToDir: string;

  const olderUserId = `usr_legacy_older_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const newerUserId = `usr_legacy_newer_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

  beforeAll(async () => {
    instance = await startPostgresInstance();
    const db = await instance.createDatabase("bootstrap_upgrade");
    databaseUrl = db.url;
    dropDb = db.drop;

    // 1. Bring the schema up to the revision immediately BEFORE od-5j8.1 —
    //    the `user` table exists but has no `is_install_admin` column yet,
    //    matching every installation that predates this migration pair.
    preDir = preBootstrapMigrationsDir();
    await applyMigrations(databaseUrl, preDir);

    // 2. Seed a legacy install: two pre-existing users, created 10 and 5
    //    days ago respectively (bypassing better-auth entirely — this
    //    installation predates the bootstrap flow, so no signup hook ever
    //    ran for them).
    sql = new SQL({ url: databaseUrl, max: 5 });
    await sql`
      insert into "user" (id, name, email, email_verified, created_at, updated_at)
      values (${olderUserId}, 'Legacy Owner', ${`legacy-owner-${randomUUID()}@example.com`}, true, now() - interval '10 days', now() - interval '10 days')
    `;
    await sql`
      insert into "user" (id, name, email, email_verified, created_at, updated_at)
      values (${newerUserId}, 'Legacy Member', ${`legacy-member-${randomUUID()}@example.com`}, true, now() - interval '5 days', now() - interval '5 days')
    `;
  }, 90_000);

  afterAll(async () => {
    await sql?.close();
    await dropDb?.();
    await instance?.stop();
    if (preDir) cleanupMigrationsDir(preDir);
    if (upToDir) cleanupMigrationsDir(upToDir);
  });

  test("upgrading an existing install backfills the OLDEST user as install admin and marks bootstrap complete", async () => {
    // Sanity: pre-migration, is_install_admin doesn't exist at all.
    const preColumns = await sql`
      select column_name from information_schema.columns
      where table_name = 'user' and column_name = 'is_install_admin'
    `;
    expect(preColumns).toHaveLength(0);

    // 3. Apply exactly the two bootstrap migrations on top.
    upToDir = upToBootstrapMigrationsDir();
    await applyMigrations(databaseUrl, upToDir);

    // 4. The oldest user (by created_at, then id) is now the sole install
    //    admin — never the newer one.
    const admins = await sql`select id from "user" where is_install_admin = true`;
    expect(admins).toHaveLength(1);
    expect(admins[0].id).toBe(olderUserId);

    const newer = await sql`select is_install_admin from "user" where id = ${newerUserId}`;
    expect(newer[0].is_install_admin).toBe(false);

    // 5. The install is marked already-bootstrapped, so a fresh signup on
    //    this upgraded instance would hit the same "invite only" branch
    //    bootstrap-fresh.postgres.test.ts proves against a new install —
    //    it must never re-open the token-gated bootstrap flow.
    const [settings] = await sql`select bootstrap_completed_at from platform_settings where id = 'platform'`;
    expect(settings).toBeTruthy();
    expect(settings.bootstrap_completed_at).not.toBeNull();
  });
});
