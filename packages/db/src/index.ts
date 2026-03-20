import { env } from "@otterstack/env/server";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "./schema/index.js";

export const db = drizzle(env.DATABASE_URL, { schema });
