import { env } from "@otterdeploy/env/server";
import { drizzle } from "drizzle-orm/node-postgres";

import { redisCache } from "./cache";
import { relations } from "./relations";

// `relations` is the RQB v2 wiring (drizzle-orm 1.0 dropped the
// per-table `relations()` calls in favour of one `defineRelations()`).
// Only auth-domain tables have relations defined; every other call
// site uses plain `db.select()` and ignores `db.query.*`. Better
// Auth's drizzle adapter needs this to run with
// `experimental.joins: true`.
export const db = drizzle(env.DATABASE_URL, {
  cache: redisCache({ global: true, ttl: 60 }),
  relations,
  // logger: true,
});
