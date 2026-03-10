import type { db } from "@otterdeploy/db";
import type { auth } from "@otterdeploy/auth";

export interface Context {
  db: typeof db;
  auth: typeof auth;
  session: {
    userId: string;
    organizationId: string | null;
  } | null;
}
