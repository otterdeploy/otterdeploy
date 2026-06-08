import { env } from "@otterdeploy/env/server";
import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";

import { redisCache } from "./cache";
import { relations } from "./relations";

// Own the underlying pool explicitly. Bun's SQL driver defaults to an
// uncapped-feeling pool with no idle reaping, so under `bun --hot` every
// reload re-evaluates this module, builds a fresh pool, and orphans the
// previous one's sockets — they pile up until Postgres hits
// `max_connections` and starts returning `53300 too many clients`. Capping
// `max` and reaping idle/aged connections keeps a single process bounded
// and lets any leaked pool drain itself.
const client = new SQL({
  url: env.DATABASE_URL,
  max: 10,
  idleTimeout: 20,
  maxLifetime: 60 * 30,
});

// `relations` (from defineRelations()) powers the RQB v2 query builder
// (`db.query.<table>.findMany({ with: { … } })`). It's additive — plain
// `db.select()` / `.leftJoin()` call sites are unaffected. better-auth's
// drizzle adapter still issues plain selects unless `experimental.joins`
// is enabled, so passing relations here doesn't change its behaviour.
export const db = drizzle({
  client,
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
