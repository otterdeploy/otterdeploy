/**
 * `data.*` handlers: the typed workbench path.
 *
 * Every handler follows the same three steps — resolve a target, connect (which
 * is where read-only is enforced), run a statement the SERVER built — so the
 * client never sends SQL for anything except the explicit runner, and even
 * there the session decides whether a write can land.
 */
import type { ColumnMeta } from "@otterdeploy/data-engine";

import { auth } from "@otterdeploy/auth";
import {
  buildCount,
  buildMutation,
  buildSelect,
  columnLookup,
  isEditable,
} from "@otterdeploy/data-engine";

import type { AccessMode, Connection, DataError } from "../../data";

import { requirePermission } from "../..";
import { enforceResourceScope } from "../../authz/project-scope-guards";
import {
  connect,
  execute,
  executeTransaction,
  listColumns,
  listTables,
  resolveManagedTarget,
} from "../../data";

/**
 * Map a runtime failure onto the contract's error set.
 *
 * The engine's own message is always carried through: a console that replaces
 * `column "stauts" does not exist` with "query failed" has discarded the only
 * part the user needed.
 */
interface DataErrorConstructors {
  NOT_FOUND: () => Error;
  NOT_EDITABLE: (init: { data: { reason: string } }) => Error;
  UNSUPPORTED: (init: { data: { engine: string } }) => Error;
  UNREACHABLE: (init: { data: { reason: string } }) => Error;
  QUERY_FAILED: (init: { data: { reason: string } }) => Error;
  DENIED: (init: { data: { reason: string } }) => Error;
}

function raise(error: DataError, errors: DataErrorConstructors): Error {
  const reason = error.message;
  switch (error.reason) {
    case "not_found":
      return errors.NOT_FOUND();
    case "unsupported":
      return errors.UNSUPPORTED({ data: { engine: reason } });
    case "unreachable":
    case "timeout":
      return errors.UNREACHABLE({ data: { reason } });
    case "denied":
      return errors.DENIED({ data: { reason } });
    case "query":
      return errors.QUERY_FAILED({ data: { reason } });
  }
}

/** Resolve + connect in one step, since no handler wants one without the other. */
async function open(input: {
  organizationId: Parameters<typeof resolveManagedTarget>[0]["organizationId"];
  resourceId: Parameters<typeof resolveManagedTarget>[0]["resourceId"];
  mode: AccessMode;
}): Promise<Connection> {
  const target = await resolveManagedTarget(input);
  return connect(target);
}

export const dataRouter = {
  schema: requirePermission({ database: ["read"] }).data.schema.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "resource", id: input.resourceId } });
      await enforceResourceScope(context, input.resourceId);

      const connection = await open({
        organizationId: context.activeOrganizationId,
        resourceId: input.resourceId,
        mode: "read-only",
      });

      const [tables, columns] = await Promise.all([
        listTables(connection),
        listColumns(connection),
      ]);
      if (tables.isErr()) throw raise(tables.error, errors);
      if (columns.isErr()) throw raise(columns.error, errors);

      const columnsByTable = new Map(
        columns.value.map((t) => [`${t.schema} ${t.table}`, t.columns]),
      );

      return {
        dialect: connection.dialect.id,
        defaultSchema: connection.dialect.defaultSchema,
        // Whether the ENGINE can commit a staged edit atomically at all.
        // ClickHouse cannot, so the drafts bar degrades to read-only there
        // rather than offering a commit it could not honour.
        canWrite: connection.dialect.supportsTransactions,
        tables: tables.value.map((t) => {
          const columns = columnsByTable.get(`${t.schema} ${t.name}`) ?? [];
          return {
            ...t,
            columns,
            // Per TABLE, not per engine: a table with no primary key cannot
            // have a single row targeted safely, so the grid must not offer
            // inline editing on it. Reported here rather than discovered when
            // the user has already typed an edit and pressed save.
            canEdit: t.kind === "table" && isEditable(columns),
          };
        }),
      };
    },
  ),

  browse: requirePermission({ database: ["read"] }).data.browse.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "resource", id: input.resourceId } });
      await enforceResourceScope(context, input.resourceId);

      const connection = await open({
        organizationId: context.activeOrganizationId,
        resourceId: input.resourceId,
        mode: "read-only",
      });

      const columns = await tableColumns(connection, input.schema, input.table);
      if (columns.length === 0) throw errors.NOT_FOUND();

      const lookup = columnLookup(columns);
      const statement = buildSelect({
        dialect: connection.dialect,
        schema: input.schema,
        table: input.table,
        columns: input.columns,
        filters: input.filters,
        sorts: input.sorts,
        limit: input.limit,
        offset: input.offset,
        lookup,
      });

      // Only the projected columns describe the result, and in projection order.
      const projected =
        input.columns.length === 0
          ? columns
          : input.columns.flatMap((name) => columns.filter((c) => c.name === name));

      const grid = await execute(connection, statement, {
        columns: projected,
        limit: input.limit,
      });
      if (grid.isErr()) throw raise(grid.error, errors);
      return grid.value;
    },
  ),

  count: requirePermission({ database: ["read"] }).data.count.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "resource", id: input.resourceId } });
      await enforceResourceScope(context, input.resourceId);

      const connection = await open({
        organizationId: context.activeOrganizationId,
        resourceId: input.resourceId,
        mode: "read-only",
      });
      const columns = await tableColumns(connection, input.schema, input.table);
      if (columns.length === 0) throw errors.NOT_FOUND();

      const grid = await execute(
        connection,
        buildCount({
          dialect: connection.dialect,
          schema: input.schema,
          table: input.table,
          filters: input.filters,
          lookup: columnLookup(columns),
        }),
        { kinds: ["bigint"] },
      );
      if (grid.isErr()) throw raise(grid.error, errors);

      const cell = grid.value.rows[0]?.[0];
      const total = cell !== null && cell !== undefined && "v" in cell ? Number(cell.v) : 0;
      return { total: Number.isFinite(total) ? total : 0 };
    },
  ),

  run: requirePermission({ database: ["query"] }).data.run.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        target: { type: "resource", id: input.resourceId },
        // The statement is audited whether or not it succeeds. Truncated
        // because a console can legitimately paste a very large script.
        dbRun: { sql: input.sql.slice(0, 2000), write: input.write },
      });
      await enforceResourceScope(context, input.resourceId);

      // Opting into writes needs the write scope, not just the query scope.
      // Checked here rather than in the contract because it depends on `write`.
      if (input.write) {
        // An API-key actor has no session for better-auth's role check, so the
        // write path is a session surface only. Same rule the old
        // `database.capabilities` handler applies.
        if (context.apiKey) {
          throw errors.DENIED({
            data: { reason: "writes require an interactive session, not an API key" },
          });
        }
        const { success } = await auth.api.hasPermission({
          headers: context.headers,
          body: { permissions: { database: ["write"] } },
        });
        if (!success) {
          throw errors.DENIED({
            data: { reason: "you do not have permission to write to this database" },
          });
        }
      }

      const connection = await open({
        organizationId: context.activeOrganizationId,
        resourceId: input.resourceId,
        mode: input.write ? "read-write" : "read-only",
      });

      const grid = await execute(
        connection,
        { sql: input.sql, params: [] },
        { limit: input.limit },
      );
      if (grid.isErr()) throw raise(grid.error, errors);
      return grid.value;
    },
  ),

  mutate: requirePermission({ database: ["write"] }).data.mutate.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        target: { type: "resource", id: input.resourceId },
        // What changed, never the values: the audit table is readable by
        // operators and kept for 90 days, so a column's contents must not land
        // in it. Which table and which columns is what an auditor needs.
        dbMutate: {
          count: input.mutations.length,
          tables: [...new Set(input.mutations.map((m) => `${m.schema}.${m.table}`))],
          columns: [...new Set(input.mutations.flatMap((m) => m.set.map((s) => s.column)))],
        },
      });
      await enforceResourceScope(context, input.resourceId);

      const connection = await open({
        organizationId: context.activeOrganizationId,
        resourceId: input.resourceId,
        mode: "read-write",
      });

      // Build every statement BEFORE opening the transaction. A mutation that
      // cannot be built is a client error, and discovering it halfway through
      // would mean rolling back writes that were themselves valid.
      const statements = [];
      for (const mutation of input.mutations) {
        const columns = await tableColumns(connection, mutation.schema, mutation.table);
        if (columns.length === 0) throw errors.NOT_FOUND();
        const built = buildMutation(mutation, { dialect: connection.dialect, columns });
        if (built.isErr()) {
          throw errors.NOT_EDITABLE({ data: { reason: built.error.message } });
        }
        statements.push(built.value);
      }

      const startedAt = performance.now();
      const grids = await executeTransaction(connection, statements);
      if (grids.isErr()) throw raise(grids.error, errors);

      return {
        rowsAffected: grids.value.reduce((total, g) => total + (g.rowsAffected ?? 0), 0),
        durationMs: Math.round(performance.now() - startedAt),
      };
    },
  ),
};

/** Columns for one table, from the same single-round-trip introspection. */
async function tableColumns(
  connection: Connection,
  schema: string,
  table: string,
): Promise<ColumnMeta[]> {
  const all = await listColumns(connection);
  if (all.isErr()) return [];
  const hit = all.value.find((t) => t.table === table && (schema === "" || t.schema === schema));
  return hit?.columns ?? [];
}
