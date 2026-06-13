/**
 * Prop type for the Postgres (database) resource-detail panel and its tabs.
 *
 * Derived from the `project.resource.list` oRPC output rather than hand-written,
 * so it can't drift from the server contract: the list returns a discriminated
 * union of database + service resources, and we narrow to the database member
 * (the one carrying credentials, connection strings, runtime, and extensions).
 */

import type { InferRouterOutputs } from "@orpc/server";
import type { AppRouter } from "@otterdeploy/api/routers/index";

/** A single database resource as returned by `project.resource.list`. */
type DatabaseResource = Extract<
  InferRouterOutputs<AppRouter>["project"]["resource"]["list"][number],
  { type: "database" }
>;

export interface PostgresBodyProps {
  resource: DatabaseResource;
}
