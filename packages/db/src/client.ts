import { env } from "@otterdeploy/env/server";
import { drizzle } from "drizzle-orm/node-postgres";

import { redisCache } from "./cache";

// drizzle-orm 1.0 dropped the `schema` config field — RQB v2 expects a
// `relations` object produced by `defineRelations()`. We don't use the
// query builder (every call site uses plain selects), so we leave both
// off and just pass `cache`. If RQB ever lands again we'll define
// relations and pass them here.
export const db = drizzle(env.DATABASE_URL, {
  cache: redisCache({ global: true, ttl: 60 }),
  // logger: true,
});
