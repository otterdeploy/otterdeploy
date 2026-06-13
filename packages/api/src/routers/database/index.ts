import { requirePermission } from "../..";

import {
  QueryError,
  UnsupportedEngineError,
  getDatabaseConnInfo,
  runReadOnlyQuery,
} from "./query";

const TABLES_SQL = `
  SELECT table_schema, table_name
  FROM information_schema.tables
  WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
    AND table_type = 'BASE TABLE'
  ORDER BY table_schema, table_name
`;

export const databaseRouter = {
  tables: requirePermission({ database: ["read"] }).database.tables.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "resource", id: input.resourceId } });
      const conn = await getDatabaseConnInfo({
        organizationId: context.activeOrganizationId,
        resourceId: input.resourceId,
      });
      if (!conn) throw errors.NOT_FOUND();
      if (conn.engine !== "postgres") throw errors.UNSUPPORTED();

      try {
        const grid = await runReadOnlyQuery(conn, TABLES_SQL, 5000);
        return {
          tables: grid.rows.map((r) => ({
            schema: r[0] ?? "",
            name: r[1] ?? "",
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

  query: requirePermission({ database: ["query"] }).database.query.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "resource", id: input.resourceId } });
      const conn = await getDatabaseConnInfo({
        organizationId: context.activeOrganizationId,
        resourceId: input.resourceId,
      });
      if (!conn) throw errors.NOT_FOUND();
      if (conn.engine !== "postgres") throw errors.UNSUPPORTED();

      try {
        return await runReadOnlyQuery(conn, input.sql, input.limit);
      } catch (cause) {
        if (cause instanceof UnsupportedEngineError) throw errors.UNSUPPORTED();
        if (cause instanceof QueryError) {
          throw errors.QUERY_FAILED({ data: { reason: cause.message } });
        }
        throw errors.QUERY_FAILED({
          data: { reason: cause instanceof Error ? cause.message : String(cause) },
        });
      }
    },
  ),
};
