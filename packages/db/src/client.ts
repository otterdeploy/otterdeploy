import { env } from "@otterstack/env/server";
import { drizzle } from "drizzle-orm/node-postgres";

import { redisCache } from "./cache";
import * as schema from "./schema/index";

export const db = drizzle(env.DATABASE_URL, {
  schema,
  cache: redisCache({ global: true, ttl: 60 }),
  // logger: true,
});
