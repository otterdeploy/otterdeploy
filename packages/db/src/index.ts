import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@otterdeploy/env/server";
import * as schema from "./schema";

const client = postgres(env.DATABASE_URL);
export const db = drizzle(client, { schema });

export { eq, and, or, ne, gt, gte, lt, lte, isNull, isNotNull, inArray, notInArray, sql, desc, asc, count } from "drizzle-orm";
export type { InferSelectModel, InferInsertModel } from "drizzle-orm";
