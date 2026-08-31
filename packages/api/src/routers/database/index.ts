/**
 * `database.*`: what is left after the data viewer moved to `data.*`.
 *
 * The relational browsing procedures — `tables`, `query`, `execute`,
 * `capabilities`, `mutateRow`, `connections` — are gone. They shipped
 * hand-written catalog SQL from the browser, ran it through
 * `docker exec … psql --csv`, and returned `Array<Array<string | null>>`, a
 * shape in which SQL NULL and the empty string are the same value. Their
 * replacements live in `packages/api/src/routers/data`, over a wire driver.
 *
 * What remains here is everything that was never about browsing a table: the
 * non-relational viewers (Redis / MongoDB / MariaDB), ephemeral credentials,
 * the org-wide catalog page, and shared-server placement.
 */
import { requirePermission } from "../..";
import { enforceResourceScope } from "../../authz/project-scope-guards";
import { catalogDatabaseHandlers } from "./catalog";
import { ephemeralDatabaseHandlers } from "./ephemeral";
import { hostDatabaseHandlers } from "./hosts";
import { nosqlDatabaseHandlers } from "./nosql-handlers";
import { UnsupportedEngineError, getDatabaseConnInfo, runReadOnlyQuery } from "./query";

// Client backends only, minus this probe's own session. The same filter the
// catalog count uses, so the breakdown always sums to the number on the card.
// `max_connections` rides along in the same round trip.
const CONNECTIONS_SQL = `
  SELECT coalesce(host(client_addr), 'local socket') AS client_addr,
         coalesce(usename, '') AS usename,
         coalesce(application_name, '') AS application_name,
         coalesce(state, '') AS state,
         count(*)::text AS sessions,
         current_setting('max_connections') AS max_connections
  FROM pg_stat_activity
  WHERE backend_type = 'client backend' AND pid <> pg_backend_pid()
  GROUP BY 1, 2, 3, 4
  ORDER BY count(*) DESC, 1, 2
`;

export const databaseRouter = {
  connections: requirePermission({ database: ["read"] }).database.connections.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "resource", id: input.resourceId } });
      await enforceResourceScope(context, input.resourceId);
      const conn = await getDatabaseConnInfo({
        organizationId: context.activeOrganizationId,
        resourceId: input.resourceId,
      });
      if (!conn) throw errors.NOT_FOUND();
      if (conn.engine !== "postgres") throw errors.UNSUPPORTED();

      try {
        const grid = await runReadOnlyQuery(conn, CONNECTIONS_SQL, 500);
        const maxRaw = Number.parseInt(grid.rows[0]?.[5] ?? "", 10);
        return {
          maxConnections: Number.isFinite(maxRaw) ? maxRaw : null,
          groups: grid.rows.map((r) => ({
            clientAddr: r[0] ?? "",
            user: r[1] ?? "",
            applicationName: r[2] ?? "",
            state: r[3] ?? "",
            count: Number.parseInt(r[4] ?? "0", 10) || 0,
          })),
        };
      } catch (cause) {
        if (cause instanceof UnsupportedEngineError) throw errors.UNSUPPORTED();
        throw errors.QUERY_FAILED({
          data: { reason: cause instanceof Error ? cause.message : String(cause) },
        });
      }
    },
  ),
  // Redis / MariaDB / MongoDB viewer handlers live in a sibling module; spread
  // here so the router's flat procedure shape stays unchanged.
  ...nosqlDatabaseHandlers,
  ...ephemeralDatabaseHandlers,
  // Org-wide catalog (the /$org/databases page).
  ...catalogDatabaseHandlers,
  // Shared servers: which ones can take another logical database.
  ...hostDatabaseHandlers,
};
