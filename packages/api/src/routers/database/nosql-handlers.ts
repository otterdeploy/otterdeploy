/**
 * Non-relational data-viewer handlers (Redis / MariaDB / MongoDB) for the
 * database router. Split out of `index.ts`; spread back into `databaseRouter`
 * so the router's flat procedure shape stays unchanged.
 */
import { requirePermission } from "../..";
import { enforceResourceScope } from "../../authz/project-scope-guards";
import { mariadbBrowse, mariadbTables } from "./mariadb";
import { mongoCollections, mongoDocuments } from "./mongo";
import { QueryError, UnsupportedEngineError, getDatabaseConnInfo } from "./query";
import { redisKeyspace, redisReadValue, redisScanKeys } from "./redis";

export const nosqlDatabaseHandlers = {
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
