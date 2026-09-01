/**
 * `data.*` handlers: the typed workbench path.
 *
 * Every handler follows the same three steps — resolve a target, connect (which
 * is where read-only is enforced), run a statement the SERVER built — so the
 * client never sends SQL for anything except the explicit runner, and even
 * there the session decides whether a write can land.
 */

import { auth } from "@otterdeploy/auth";
import {
  buildCount,
  buildMutation,
  buildSelect,
  columnLookup,
  displayText,
  isEditable,
  validateQueryInput,
} from "@otterdeploy/data-engine";
import { Result } from "better-result";

import { requirePermission } from "../..";
import {
  execute,
  executeTransaction,
  listColumns,
  listConstraints,
  listEnums,
  listIndexes,
  listTables,
  purgeIntrospectionCache,
  tableColumns,
} from "../../data";
import { makeConnectionHandlers } from "./connections";
import { guardTarget, open, raise, targetLog, viewerIdOf } from "./plumbing";
import { makeSessionHandlers } from "./sessions";

async function mayWrite(context: { apiKey?: unknown; headers: Headers }): Promise<boolean> {
  if (context.apiKey) return false;
  const { success } = await auth.api.hasPermission({
    headers: context.headers,
    body: { permissions: { database: ["write"] } },
  });
  return success;
}

/**
 * Map a runtime failure onto the contract's error set.
 *
 * The engine's own message is always carried through: a console that replaces
 * `column "stauts" does not exist` with "query failed" has discarded the only
 * part the user needed.
 */

export const dataRouter = {
  ...makeConnectionHandlers({ viewerIdOf }),
  ...makeSessionHandlers({ viewerIdOf }),

  schema: requirePermission({ database: ["read"] }).data.schema.handler(
    async ({ input, context, errors }) => {
      context.log.set(targetLog(input.target));
      await guardTarget(context, input.target);

      const connection = await open(context, input.target, "read-only", errors);

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
        canWrite:
          connection.dialect.supportsTransactions &&
          connection.target.writeAllowed &&
          (await mayWrite(context)),
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

  definitions: requirePermission({ database: ["read"] }).data.definitions.handler(
    async ({ input, context, errors }) => {
      context.log.set(targetLog(input.target));
      await guardTarget(context, input.target);

      const connection = await open(context, input.target, "read-only", errors);
      // In parallel: three independent catalog reads with no ordering between
      // them, so serialising would just add two round trips of latency.
      const [indexes, constraints, enums] = await Promise.all([
        listIndexes(connection),
        listConstraints(connection),
        listEnums(connection),
      ]);
      if (indexes.isErr()) throw raise(indexes.error, errors);
      if (constraints.isErr()) throw raise(constraints.error, errors);
      if (enums.isErr()) throw raise(enums.error, errors);

      return {
        indexes: indexes.value.flatMap((t) =>
          t.indexes.map((i) => ({ schema: t.schema, table: t.table, ...i })),
        ),
        constraints: constraints.value.flatMap((t) =>
          t.constraints.map((c) => ({ schema: t.schema, table: t.table, ...c })),
        ),
        enums: enums.value,
      };
    },
  ),

  browse: requirePermission({ database: ["read"] }).data.browse.handler(
    async ({ input, context, errors }) => {
      context.log.set(targetLog(input.target));
      await guardTarget(context, input.target);

      const connection = await open(context, input.target, "read-only", errors);

      const foundColumns = await tableColumns(connection, input.schema, input.table);
      if (foundColumns.isErr()) throw raise(foundColumns.error, errors);
      const columns = foundColumns.value;
      if (columns.length === 0) throw errors.NOT_FOUND();

      const lookup = columnLookup(columns);
      const validated = validateQueryInput(input, lookup);
      if (validated.isErr()) {
        throw errors.QUERY_FAILED({ data: { reason: validated.error.message } });
      }
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
        trustedRead: true,
      });
      if (grid.isErr()) throw raise(grid.error, errors);
      return grid.value;
    },
  ),

  count: requirePermission({ database: ["read"] }).data.count.handler(
    async ({ input, context, errors }) => {
      context.log.set(targetLog(input.target));
      await guardTarget(context, input.target);

      const connection = await open(context, input.target, "read-only", errors);
      const foundColumns = await tableColumns(connection, input.schema, input.table);
      if (foundColumns.isErr()) throw raise(foundColumns.error, errors);
      const columns = foundColumns.value;
      if (columns.length === 0) throw errors.NOT_FOUND();
      const lookup = columnLookup(columns);
      const validated = validateQueryInput({ filters: input.filters }, lookup);
      if (validated.isErr()) {
        throw errors.QUERY_FAILED({ data: { reason: validated.error.message } });
      }

      const grid = await execute(
        connection,
        buildCount({
          dialect: connection.dialect,
          schema: input.schema,
          table: input.table,
          filters: input.filters,
          lookup,
        }),
        { kinds: ["bigint"], trustedRead: true },
      );
      if (grid.isErr()) throw raise(grid.error, errors);

      const cell = grid.value.rows[0]?.[0];
      const raw = cell === null || cell === undefined ? "0" : displayText(cell);
      const parsed = Result.try({ try: () => BigInt(raw), catch: () => undefined });
      if (parsed.isErr() || parsed.value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw errors.QUERY_FAILED({
          data: { reason: "row count exceeds the largest value this grid can page safely" },
        });
      }
      return { total: Number(parsed.value) };
    },
  ),

  run: requirePermission({ database: ["query"] }).data.run.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        ...targetLog(input.target),
        // The statement is audited whether or not it succeeds. Truncated
        // because a console can legitimately paste a very large script.
        dbRun: { sql: input.sql.slice(0, 2000), write: input.write },
      });
      await guardTarget(context, input.target);

      // Opting into writes needs the write scope, not just the query scope.
      // Checked here rather than in the contract because it depends on `write`.
      if (input.write) {
        if (!(await mayWrite(context))) {
          throw errors.DENIED({
            data: { reason: "you do not have permission to write to this database" },
          });
        }
      }

      const connection = await open(
        context,
        input.target,
        input.write ? "read-write" : "read-only",
        errors,
      );

      const grid = await execute(
        connection,
        { sql: input.sql, params: [] },
        { limit: input.limit },
      );
      if (grid.isErr()) throw raise(grid.error, errors);
      // A write may have been DDL; the cached columns are no longer the truth.
      if (input.write) purgeIntrospectionCache(connection.target.poolKey);
      return grid.value;
    },
  ),

  mutate: requirePermission({ database: ["write"] }).data.mutate.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        ...targetLog(input.target),
        // What changed, never the values: the audit table is readable by
        // operators and kept for 90 days, so a column's contents must not land
        // in it. Which table and which columns is what an auditor needs.
        dbMutate: {
          count: input.mutations.length,
          tables: [...new Set(input.mutations.map((m) => `${m.schema}.${m.table}`))],
          columns: [...new Set(input.mutations.flatMap((m) => m.set.map((s) => s.column)))],
        },
      });
      await guardTarget(context, input.target);

      if (!(await mayWrite(context))) {
        throw errors.DENIED({
          data: { reason: "writes require an interactive session with database write permission" },
        });
      }

      const connection = await open(context, input.target, "read-write", errors);
      if (!connection.target.writeAllowed || connection.target.mode === "read-only") {
        throw errors.DENIED({ data: { reason: "this connection is configured read-only" } });
      }

      // Build every statement BEFORE opening the transaction. A mutation that
      // cannot be built is a client error, and discovering it halfway through
      // would mean rolling back writes that were themselves valid.
      const allColumns = await listColumns(connection);
      if (allColumns.isErr()) throw raise(allColumns.error, errors);
      const columnsByTable = new Map(
        allColumns.value.map((entry) => [`${entry.schema} ${entry.table}`, entry.columns]),
      );
      const statements = [];
      for (const mutation of input.mutations) {
        const columns = columnsByTable.get(`${mutation.schema} ${mutation.table}`) ?? [];
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
      purgeIntrospectionCache(connection.target.poolKey);

      return {
        rowsAffected: grids.value.reduce((total, g) => total + (g.rowsAffected ?? 0), 0),
        durationMs: Math.round(performance.now() - startedAt),
      };
    },
  ),
};
