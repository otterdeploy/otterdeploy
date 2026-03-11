import type { db } from "@otterdeploy/db";
import type { auth } from "@otterdeploy/auth";

export interface Context {
  db: typeof db;
  session: Awaited<ReturnType<typeof auth.api.getSession>>;
}
