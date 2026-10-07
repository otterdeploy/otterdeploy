/**
 * Global setup for the real-Postgres half of this package's suite
 * (`*.postgres.test.ts`, see vitest.postgres.config.ts).
 *
 * `INTEGRATION_POSTGRES_URL` names a disposable server (CI's integration job
 * supplies its postgres service container). One uniquely named database is
 * created on it per run, migrated with the REAL drizzle migrations from
 * packages/db, then handed to the test workers through `DATABASE_URL`. That
 * variable is read once, when `@otterdeploy/db` is first evaluated, and the
 * workers are spawned after this function returns, so setting it here is what
 * points the db singleton (and every query module built on it) at the
 * throwaway database. Test files keep themselves apart with unique ids, not
 * separate databases. The database is dropped on teardown.
 */
import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = fileURLToPath(new URL("../db/src/migrations", import.meta.url));

async function withClient(url: string, run: (client: SQL) => Promise<unknown>): Promise<void> {
  const client = new SQL({ url, max: 1 });
  try {
    await run(client);
  } finally {
    await client.close();
  }
}

export default async function setup(): Promise<() => Promise<void>> {
  /* oxlint-disable-next-line node/no-process-env -- test env boundary: CI-supplied server, outside the server env schema */
  const adminUrl = process.env.INTEGRATION_POSTGRES_URL;
  if (!adminUrl) {
    throw new Error(
      "INTEGRATION_POSTGRES_URL is not set: point it at a disposable PostgreSQL server to run *.postgres.test.ts",
    );
  }

  const name = `api_it_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  await withClient(adminUrl, (admin) => admin.unsafe(`CREATE DATABASE "${name}"`));
  const databaseUrl = new URL(adminUrl);
  databaseUrl.pathname = `/${name}`;
  await withClient(databaseUrl.toString(), (client) =>
    migrate(drizzle({ client }), { migrationsFolder: MIGRATIONS_DIR }),
  );

  /* oxlint-disable node/no-process-env -- test env boundary: points the workers' db singleton at the throwaway database before they start */
  process.env.DATABASE_URL = databaseUrl.toString();
  // Deliberately unreachable: the drizzle query cache degrades to a miss and
  // never throws (packages/db/src/cache.ts), so reads are always fresh and a
  // developer's running Redis is never written to.
  process.env.REDIS_URL = "redis://127.0.0.1:65535/0";
  /* oxlint-enable node/no-process-env */

  return async () => {
    await withClient(adminUrl, (admin) =>
      admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`),
    );
  };
}
