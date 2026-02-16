import { env } from "@otterstack/env/database";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "./schema";

export const db = drizzle(env.DATABASE_URL, { schema });
export {
  eq,
  and,
  inArray,
  or,
  ne,
  gt,
  gte,
  lt,
  lte,
  like,
  ilike,
  notLike,
  between,
  notBetween,
  isNotNull,
  isNull,
  is,
  exists,
  notExists,
  desc,
  asc,
  sql,
} from "drizzle-orm";
