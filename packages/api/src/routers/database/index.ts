import { auth } from "@otterdeploy/auth";

import { requirePermission } from "../..";
import { enforceResourceScope } from "../../authz/project-scope-guards";

import {
  QueryError,
  UnsupportedEngineError,
  buildDeleteSql,
  buildInsertSql,
  buildUpdateSql,
  getDatabaseConnInfo,
  runReadOnlyQuery,
  runWriteQuery,
} from "./query";
import { redisKeyspace, redisReadValue, redisScanKeys } from "./redis";
import { mariadbBrowse, mariadbTables } from "./mariadb";
import { mongoCollections, mongoDocuments } from "./mongo";

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
      await enforceResourceScope(context, input.resourceId);
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
      await enforceResourceScope(context, input.resourceId);
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

  // Whether the actor may mutate data — drives the read-only vs editable UI.
  // Read-gated (anyone who can open the viewer can ask); the write handlers
  // enforce `database:write` themselves regardless of what this returns.
  capabilities: requirePermission({ database: ["read"] }).database.capabilities.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "resource", id: input.resourceId } });
      await enforceResourceScope(context, input.resourceId);
      const conn = await getDatabaseConnInfo({
        organizationId: context.activeOrganizationId,
        resourceId: input.resourceId,
      });
      if (!conn) throw errors.NOT_FOUND();

      // The data viewer's write UI is a web (session) surface; an API-key actor
      // has no session for better-auth's role check, so report read-only.
      if (context.apiKey) return { canWrite: false };

      const { success } = await auth.api.hasPermission({
        headers: context.headers,
        body: { permissions: { database: ["write"] } },
      });
      return { canWrite: success };
    },
  ),

  // Mutate a single row, primary-key-guarded. The server builds the SQL from the
  // structured input (never a client statement) and runs it without the
  // read-only envelope.
  mutateRow: requirePermission({ database: ["write"] }).database.mutateRow.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "resource", id: input.resourceId } });
      await enforceResourceScope(context, input.resourceId);
      const conn = await getDatabaseConnInfo({
        organizationId: context.activeOrganizationId,
        resourceId: input.resourceId,
      });
      if (!conn) throw errors.NOT_FOUND();
      if (conn.engine !== "postgres") throw errors.UNSUPPORTED();

      // update/delete must target a row by primary key; insert/update need
      // columns to set.
      if (input.op !== "insert" && input.pk.length === 0) {
        throw errors.NO_PRIMARY_KEY();
      }
      if (input.op !== "delete" && input.set.length === 0) {
        throw errors.QUERY_FAILED({ data: { reason: "no columns to set" } });
      }

      const sql =
        input.op === "update"
          ? buildUpdateSql(input.schema, input.table, input.set, input.pk)
          : input.op === "delete"
            ? buildDeleteSql(input.schema, input.table, input.pk)
            : buildInsertSql(input.schema, input.table, input.set);

      try {
        const grid = await runWriteQuery(conn, sql, 1000);
        return {
          columns: grid.columns,
          rows: grid.rows,
          rowsAffected: grid.rowCount,
        };
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

  // ── Redis ──────────────────────────────────────────────────────────────
  redisKeyspace: requirePermission({ database: ["read"] }).database.redisKeyspace.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "resource", id: input.resourceId } });
      await enforceResourceScope(context, input.resourceId);
      const conn = await getDatabaseConnInfo({
        organizationId: context.activeOrganizationId,
        resourceId: input.resourceId,
      });
      if (!conn) throw errors.NOT_FOUND();
      if (conn.engine !== "redis") throw errors.UNSUPPORTED();

      try {
        return { databases: await redisKeyspace(conn) };
      } catch (cause) {
        if (cause instanceof UnsupportedEngineError) throw errors.UNSUPPORTED();
        throw errors.QUERY_FAILED({
          data: { reason: cause instanceof Error ? cause.message : String(cause) },
        });
      }
    },
  ),

  redisKeys: requirePermission({ database: ["read"] }).database.redisKeys.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "resource", id: input.resourceId } });
      await enforceResourceScope(context, input.resourceId);
      const conn = await getDatabaseConnInfo({
        organizationId: context.activeOrganizationId,
        resourceId: input.resourceId,
      });
      if (!conn) throw errors.NOT_FOUND();
      if (conn.engine !== "redis") throw errors.UNSUPPORTED();

      try {
        return await redisScanKeys(conn, {
          db: input.db,
          match: input.match,
          cursor: input.cursor,
          count: input.count,
        });
      } catch (cause) {
        if (cause instanceof UnsupportedEngineError) throw errors.UNSUPPORTED();
        throw errors.QUERY_FAILED({
          data: { reason: cause instanceof Error ? cause.message : String(cause) },
        });
      }
    },
  ),

  redisValue: requirePermission({ database: ["query"] }).database.redisValue.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "resource", id: input.resourceId } });
      await enforceResourceScope(context, input.resourceId);
      const conn = await getDatabaseConnInfo({
        organizationId: context.activeOrganizationId,
        resourceId: input.resourceId,
      });
      if (!conn) throw errors.NOT_FOUND();
      if (conn.engine !== "redis") throw errors.UNSUPPORTED();

      try {
        return await redisReadValue(conn, {
          db: input.db,
          key: input.key,
          limit: input.limit,
        });
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

  // ── MariaDB ──────────────────────────────────────────────────────────────
  mariadbTables: requirePermission({ database: ["read"] }).database.mariadbTables.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "resource", id: input.resourceId } });
      await enforceResourceScope(context, input.resourceId);
      const conn = await getDatabaseConnInfo({
        organizationId: context.activeOrganizationId,
        resourceId: input.resourceId,
      });
      if (!conn) throw errors.NOT_FOUND();
      if (conn.engine !== "mariadb") throw errors.UNSUPPORTED();

      try {
        return { tables: await mariadbTables(conn) };
      } catch (cause) {
        if (cause instanceof UnsupportedEngineError) throw errors.UNSUPPORTED();
        throw errors.QUERY_FAILED({
          data: { reason: cause instanceof Error ? cause.message : String(cause) },
        });
      }
    },
  ),

  mariadbRows: requirePermission({ database: ["query"] }).database.mariadbRows.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "resource", id: input.resourceId } });
      await enforceResourceScope(context, input.resourceId);
      const conn = await getDatabaseConnInfo({
        organizationId: context.activeOrganizationId,
        resourceId: input.resourceId,
      });
      if (!conn) throw errors.NOT_FOUND();
      if (conn.engine !== "mariadb") throw errors.UNSUPPORTED();

      try {
        return await mariadbBrowse(conn, {
          schema: input.schema,
          table: input.table,
          limit: input.limit,
          offset: input.offset,
        });
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

  // ── MongoDB ──────────────────────────────────────────────────────────────
  mongoCollections: requirePermission({ database: ["read"] }).database.mongoCollections.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "resource", id: input.resourceId } });
      await enforceResourceScope(context, input.resourceId);
      const conn = await getDatabaseConnInfo({
        organizationId: context.activeOrganizationId,
        resourceId: input.resourceId,
      });
      if (!conn) throw errors.NOT_FOUND();
      if (conn.engine !== "mongodb") throw errors.UNSUPPORTED();

      try {
        return { collections: await mongoCollections(conn) };
      } catch (cause) {
        if (cause instanceof UnsupportedEngineError) throw errors.UNSUPPORTED();
        throw errors.QUERY_FAILED({
          data: { reason: cause instanceof Error ? cause.message : String(cause) },
        });
      }
    },
  ),

  mongoDocuments: requirePermission({ database: ["query"] }).database.mongoDocuments.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "resource", id: input.resourceId } });
      await enforceResourceScope(context, input.resourceId);
      const conn = await getDatabaseConnInfo({
        organizationId: context.activeOrganizationId,
        resourceId: input.resourceId,
      });
      if (!conn) throw errors.NOT_FOUND();
      if (conn.engine !== "mongodb") throw errors.UNSUPPORTED();

      try {
        return await mongoDocuments(conn, {
          collection: input.collection,
          limit: input.limit,
          skip: input.skip,
        });
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
