import { env } from "@otterstack/env/server";
import { drizzle } from "drizzle-orm/node-postgres";
import { upstashCache } from "drizzle-orm/cache/upstash";

import * as schema from "./schema/index";

export const db = drizzle(env.DATABASE_URL, {
  schema,
  cache: upstashCache({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
    global: true,
  }),
  // logger: true,
});
