import { env } from "@otterdeploy/env/server";
import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";

import { redisCache } from "./cache";
import { withQueryDeadlines } from "./query-deadline";
import { relations } from "./relations";

// Own the underlying pool explicitly. Bun's SQL driver defaults to an
// uncapped-feeling pool with no idle reaping, so under `bun --hot` every
// reload re-evaluates this module, builds a fresh pool, and orphans the
// previous one's sockets. They pile up until Postgres hits
// `max_connections` and starts returning `53300 too many clients`. Capping
// `max` and reaping idle/aged connections keeps a single process bounded
// and lets any leaked pool drain itself.
/**
 * How long to wait for a new connection to be established (TCP + auth) before
 * the query that needed it fails. Bun's default is 30s; with the procedure
 * deadline at 120s that let a hung or black-holed Postgres (connections
 * accepted, never answered) hold every request until the deadline.
 * The control plane's Postgres sits next to it (same host or Docker network),
 * where a healthy connect takes milliseconds, so 5s is generous and still
 * answers well inside any client's patience.
 */
export const DB_CONNECT_TIMEOUT_SECONDS = 5;

/**
 * Server-side `statement_timeout` for every statement on this pool: a backstop
 * that frees a connection held by a stuck statement (a lock wait, a runaway
 * query) so one bad statement cannot drain the 10-connection pool. Deliberately
 * generous (5 minutes): request-path statements are already abandoned by the
 * 120s procedure deadline, and background work (retention sweeps, analytics
 * rollups) must never be cut short by a value tuned for requests. Migrations
 * run on their own connection without it (migrate.ts).
 *
 * Sent as a startup parameter. The supported topology connects straight to
 * the bundled Postgres; a transaction-mode pooler in front of the control
 * plane would refuse it (and Bun's prepared statements) anyway.
 */
export const DB_STATEMENT_TIMEOUT_MS = 300_000;

const client = new SQL({
  url: env.DATABASE_URL,
  max: 10,
  idleTimeout: 20,
  maxLifetime: 60 * 30,
  connectionTimeout: DB_CONNECT_TIMEOUT_SECONDS,
  connection: { statement_timeout: DB_STATEMENT_TIMEOUT_MS },
});
// Deadlines: every statement awaited inside a request scope answers in time
// or fails the request (./query-deadline.ts); outside one, a pass-through.
const queryClient = withQueryDeadlines(client);

// `relations` (from defineRelations()) powers the RQB v2 query builder
// (`db.query.<table>.findMany({ with: { … } })`). It's additive. Plain
// `db.select()` / `.leftJoin()` call sites are unaffected. better-auth's
// drizzle adapter still issues plain selects unless `experimental.joins`
// is enabled, so passing relations here doesn't change its behaviour.
export const db = drizzle({
  client: queryClient,
  relations,
  cache: redisCache({ global: true, ttl: 60 }),
  // logger: true,
});

// `bun --hot` swaps this module in place without restarting the process.
// Close the old pool when that happens so reloads don't accumulate
// connections against Postgres' `max_connections` limit.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    void client.close();
  });
}
