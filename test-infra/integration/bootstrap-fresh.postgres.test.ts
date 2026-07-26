/**
 * od-5j8.1.1 — proves the REAL better-auth signup hook
 * (packages/auth/src/index.ts databaseHooks.user.create) against a real
 * PostgreSQL 17, for a brand-new install:
 *
 *   1. missing/wrong bootstrap token is denied
 *   2. the valid first token creates the SOLE install owner + a durable
 *      `platform_settings.bootstrap_completed_at` marker
 *   3. token replay is denied, and deleting the install owner does not
 *      reopen bootstrap
 *   4. a pending invitee may sign up; an uninvited visitor may not
 *      (invite-only post-bootstrap)
 *
 * Property 5 (upgrade backfill) is covered separately in
 * bootstrap-upgrade.postgres.test.ts, which needs a *pre-existing* legacy
 * database rather than a fresh one.
 *
 * Requires either INTEGRATION_POSTGRES_URL (CI's postgres:17 service
 * container) or a local Docker daemon (spins up a throwaway postgres:17
 * container). Neither present -> the whole suite is skipped with a clear
 * message; see `bun run test:integration` / README note in
 * test-infra/integration/postgres-harness.ts.
 *
 * IMPORTANT: `@otterdeploy/env/server` validates `process.env` once, at
 * module load. Every env var this suite needs (DATABASE_URL, secrets, the
 * bootstrap token, ...) is therefore set BEFORE the dynamic `import()` of
 * `@otterdeploy/auth` in `beforeAll` — a static top-level import would run
 * too early and see the wrong (or missing) environment.
 */
import type { auth as AuthInstance } from "@otterdeploy/auth";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { randomUUID } from "node:crypto";

import { allMigrationsDir, applyMigrations } from "./migrations";
import { dockerAvailable, integrationRunnable, type PostgresInstance, startPostgresInstance } from "./postgres-harness";

const BOOTSTRAP_TOKEN = "integration-test-bootstrap-token-32chars-min";
const BOOTSTRAP_TOKEN_HEADER = "x-otterdeploy-bootstrap-token";

const canRun = integrationRunnable();
if (!canRun) {
  console.warn(
    "[integration] Skipping bootstrap-fresh Postgres suite: no INTEGRATION_POSTGRES_URL and Docker is unavailable. " +
      "Start Docker locally, or set INTEGRATION_POSTGRES_URL to a running postgres:17 instance, to run this suite.",
  );
}

async function attempt<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error };
  }
}

describe.skipIf(!canRun)("bootstrap (fresh install) — real better-auth hook + Postgres 17", () => {
  let instance: PostgresInstance;
  let databaseUrl: string;
  let dropDb: () => Promise<void>;
  let sql: SQL;
  let auth: typeof AuthInstance;

  beforeAll(async () => {
    instance = await startPostgresInstance();
    const db = await instance.createDatabase("bootstrap_fresh");
    databaseUrl = db.url;
    dropDb = db.drop;

    await applyMigrations(databaseUrl, allMigrationsDir());

    sql = new SQL({ url: databaseUrl, max: 5 });

    // Set every env var @otterdeploy/env/server validates, BEFORE the
    // dynamic import below evaluates that module for the first time.
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = "redis://127.0.0.1:65535/0"; // deliberately unreachable — RedisCache degrades to a no-op cache miss, never throws (see packages/db/src/cache.ts)
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    process.env.BETTER_AUTH_SECRET = "integration-test-better-auth-secret-32chars-min";
    process.env.OTTERDEPLOY_BOOTSTRAP_TOKEN = BOOTSTRAP_TOKEN;
    process.env.CORS_ORIGIN = "http://localhost:3001";
    process.env.NODE_ENV = "test";

    ({ auth } = await import("@otterdeploy/auth"));
  }, 90_000);

  afterAll(async () => {
    await sql?.close();
    await dropDb?.();
    await instance?.stop();
  });

  async function userCount(): Promise<number> {
    const [row] = await sql`select count(*)::int as count from "user"`;
    return row.count;
  }

  async function signUp(params: { email: string; token?: string }) {
    const headers = new Headers();
    if (params.token !== undefined) headers.set(BOOTSTRAP_TOKEN_HEADER, params.token);
    return attempt(() =>
      auth.api.signUpEmail({
        body: {
          name: "Test User",
          email: params.email,
          password: "correct-horse-battery-staple-9000",
        },
        headers,
      }),
    );
  }

  test("1a. denies signup with no bootstrap token", async () => {
    const before = await userCount();
    const result = await signUp({ email: `no-token-${randomUUID()}@example.com` });
    expect(result.ok).toBe(false);
    expect(await userCount()).toBe(before);
  });

  test("1b. denies signup with a wrong bootstrap token", async () => {
    const before = await userCount();
    const result = await signUp({ email: `wrong-token-${randomUUID()}@example.com`, token: `${BOOTSTRAP_TOKEN}-wrong` });
    expect(result.ok).toBe(false);
    expect(await userCount()).toBe(before);
  });

  const ownerEmail = "owner@example.com";

  test("2. the valid first token creates the SOLE install owner + a durable completion marker", async () => {
    const result = await signUp({ email: ownerEmail, token: BOOTSTRAP_TOKEN });
    expect(result.ok).toBe(true);

    const users = await sql`select id, email, is_install_admin from "user"`;
    expect(users).toHaveLength(1);
    expect(users[0].email).toBe(ownerEmail);
    expect(users[0].is_install_admin).toBe(true);

    const [settings] = await sql`select bootstrap_completed_at from platform_settings where id = 'platform'`;
    expect(settings).toBeTruthy();
    expect(settings.bootstrap_completed_at).not.toBeNull();
  });

  test("3a. token replay is denied (bootstrap is single-use)", async () => {
    const before = await userCount();
    const result = await signUp({ email: `replay-${randomUUID()}@example.com`, token: BOOTSTRAP_TOKEN });
    expect(result.ok).toBe(false);
    expect(await userCount()).toBe(before);
  });

  test("3b. deleting the install owner does not reopen bootstrap", async () => {
    await sql`delete from "user" where email = ${ownerEmail}`;
    expect(await userCount()).toBe(0);

    const result = await signUp({ email: `post-deletion-${randomUUID()}@example.com`, token: BOOTSTRAP_TOKEN });
    expect(result.ok).toBe(false);
    // The completion marker survived the owner's deletion — that's what
    // keeps bootstrap closed.
    const [settings] = await sql`select bootstrap_completed_at from platform_settings where id = 'platform'`;
    expect(settings.bootstrap_completed_at).not.toBeNull();
    expect(await userCount()).toBe(0);
  });

  const inviteeEmail = "invitee@example.com";
  let inviterId: string;
  let organizationId: string;

  test("4a. a pending invitee may sign up (invite-only, post-bootstrap)", async () => {
    // Seed the invitation fixture directly (org + inviter + a pending
    // invitation row) — independent of the owner deleted above; this test
    // only exercises the "hasPendingInvitation" branch of decideRegistration.
    inviterId = `usr_it_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    await sql`
      insert into "user" (id, name, email, email_verified)
      values (${inviterId}, 'Inviter', ${`inviter-${randomUUID()}@example.com`}, true)
    `;
    organizationId = `org_it_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    await sql`
      insert into organization (id, name, slug)
      values (${organizationId}, 'Integration Org', ${`integration-org-${randomUUID()}`})
    `;
    await sql`
      insert into invitation (id, organization_id, email, status, expires_at, inviter_id)
      values (${`inv_it_${randomUUID().replace(/-/g, "").slice(0, 20)}`}, ${organizationId}, ${inviteeEmail}, 'pending', now() + interval '2 days', ${inviterId})
    `;

    const result = await signUp({ email: inviteeEmail });
    expect(result.ok).toBe(true);

    const [invitee] = await sql`select is_install_admin from "user" where email = ${inviteeEmail}`;
    expect(invitee).toBeTruthy();
    expect(invitee.is_install_admin).toBe(false);
  });

  test("4b. an uninvited visitor may NOT sign up", async () => {
    const before = await userCount();
    const result = await signUp({ email: `uninvited-${randomUUID()}@example.com` });
    expect(result.ok).toBe(false);
    expect(await userCount()).toBe(before);
  });
});
