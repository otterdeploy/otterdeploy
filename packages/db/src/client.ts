import { env } from "@otterdeploy/env/server";
import { drizzle } from "drizzle-orm/node-postgres";

import { redisCache } from "./cache";

// drizzle-orm 1.0 dropped the `schema` config field in favour of a
// `relations` object produced by `defineRelations()`. Every call
// site uses plain `db.select()` so we leave it off — better-auth's
// drizzle adapter falls back to plain selects when
// `experimental.joins` isn't enabled, which is what we want here.
// Wire `relations` back in when a domain wants `db.query.*`.
export const db = drizzle(env.DATABASE_URL, {
  cache: redisCache({ global: true, ttl: 60 }),
  // logger: true,
});
