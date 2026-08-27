/**
 * Which resource's CONTAINER backs a given resource.
 *
 * Itself for a dedicated database (and for every service); its HOST for a
 * database that lives on a shared server. `backups/exec.findResourceContainerId`
 * calls this, which is what lets the data viewer, the backup engine and
 * ephemeral credentials resolve a tenant without any of them knowing tenants
 * exist.
 *
 * Deliberately its own LEAF module rather than a function in ./internals:
 * internals reaches into `backups/exec` for the docker transport, so putting
 * this beside it made `exec -> internals -> exec` a cycle, which the audit
 * ratchet fails the build over. This file imports the schema and nothing else,
 * so the edge only ever points one way. A dynamic `await import()` would have
 * hidden the same cycle instead of removing it (see od-tzw).
 */
import { db } from "@otterdeploy/db";
import { databaseResource } from "@otterdeploy/db/schema";
import { sql } from "drizzle-orm";

export async function containerResourceId(resourceId: string): Promise<string> {
  // The caller is deliberately untyped here: it resolves SERVICE ids too,
  // which never match a database row. Compare on the text column via sql``
  // rather than the branded `.$type<ResourceId>()` column, so a plain string
  // id doesn't need an assertion to be looked up.
  const [row] = await db
    .select({ hostResourceId: databaseResource.hostResourceId })
    .from(databaseResource)
    .where(sql`${databaseResource.resourceId} = ${resourceId}`)
    .limit(1);
  return row?.hostResourceId ?? resourceId;
}
