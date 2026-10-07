/**
 * The half of this package's suite that needs a real PostgreSQL (17+).
 *
 * Runs in CI's `integration` job beside vitest.redis.config.ts (the
 * `test:integration` script runs both), never in the fast `test` leg, which
 * excludes `*.postgres.test.ts` by config so a DB-backed file cannot drift
 * into a leg that has no database.
 *
 * What lives here is anything whose bug is in a query: a missing tenant or
 * environment predicate, a uniqueness rule, a read that decrypts. A mocked
 * query module would only restate the predicate under test, so these drive
 * the real query modules against a migrated database. See
 * vitest.postgres.setup.ts for how the database is provisioned.
 *
 * Locally: `INTEGRATION_POSTGRES_URL=postgres://... bun --bun vitest run
 * --config vitest.postgres.config.ts` from packages/api, pointing at a
 * disposable server.
 */
import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.postgres.test.ts"],
    globalSetup: ["./vitest.postgres.setup.ts"],
    setupFiles: ["./vitest.setup.ts"],
    // One shared, migrated database: files isolate by unique ids, and running
    // them one at a time keeps a failure's rows from interleaving with
    // another file's in the logs.
    fileParallelism: false,
    // The drizzle query cache logs a warning per query when Redis is
    // unreachable (deliberately so here, see the setup file). Keep that out of
    // a green run; a failing test still prints its logs.
    silent: "passed-only",
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
