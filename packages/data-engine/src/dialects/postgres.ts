import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

/**
 * Postgres dialect. The reference implementation: every other dialect is read
 * against this one, and anything it needs that isn't on the `Dialect` interface
 * is a sign the interface is wrong.
 *
 * Introspection reads `pg_catalog` rather than `information_schema` wherever
 * the catalog is cheaper or carries more (row estimates, index size, enum
 * labels, comments). `reltuples` is the planner's estimate and is deliberately
 * never `count(*)`.
 */
import type { Dialect, SqlCompiler } from "../dialect";
import type { CellKind } from "../value";

/** `numeric(10,2)` → `numeric`; `timestamp with time zone` stays whole. */
function baseType(dataType: string): string {
  const lower = dataType.trim().toLowerCase();
  const paren = lower.indexOf("(");
  const stripped =
    paren === -1 ? lower : lower.slice(0, paren) + lower.slice(lower.indexOf(")") + 1);
  return stripped.trim();
}

/**
 * Type name → cell family, as a table rather than a switch.
 *
 * A table is the honest shape for this: it is data about Postgres, it is read
 * once per column, and adding a type is a one-line edit that cannot fall
 * through into the wrong branch.
 */
const POSTGRES_TYPE_KINDS: ReadonlyMap<string, CellKind> = new Map([
  ["bool", "bool"],
  ["boolean", "bool"],

  ["int2", "number"],
  ["int4", "number"],
  ["smallint", "number"],
  ["integer", "number"],
  ["serial", "number"],
  ["float4", "number"],
  ["float8", "number"],
  ["real", "number"],
  ["double precision", "number"],

  // Wider than Number.MAX_SAFE_INTEGER, so it travels as an exact string.
  ["int8", "bigint"],
  ["bigint", "bigint"],
  ["bigserial", "bigint"],
  ["serial8", "bigint"],

  ["numeric", "decimal"],
  ["decimal", "decimal"],
  ["money", "decimal"],

  ["json", "json"],
  ["jsonb", "json"],
  ["bytea", "bytes"],

  ["timestamptz", "instant"],
  ["timestamp with time zone", "instant"],
  // No offset, so it is NOT a point on the timeline. Kept distinct from
  // `instant` so the UI never invents a zone the database did not store.
  ["timestamp", "datetime"],
  ["timestamp without time zone", "datetime"],
  ["date", "date"],

  ["time", "time"],
  ["timetz", "time"],
  ["time without time zone", "time"],
  ["time with time zone", "time"],

  ["text", "text"],
  ["varchar", "text"],
  ["character varying", "text"],
  ["char", "text"],
  ["character", "text"],
  ["bpchar", "text"],
  ["uuid", "text"],
  ["name", "text"],
  ["citext", "text"],
  ["inet", "text"],
  ["cidr", "text"],
  ["macaddr", "text"],
  ["xml", "text"],
]);

export function classifyPostgresType(dataType: string): CellKind {
  const t = baseType(dataType);
  // Arrays arrive as `_int4` from pg_type or `integer[]` from
  // information_schema; both mean the same thing to the grid.
  if (t.endsWith("[]") || t.startsWith("_")) return "array";
  // Enums, ranges, geometry, tsvector, user-defined composites. Transportable,
  // not interpretable — an honest `opaque` beats a lossy `text`.
  return POSTGRES_TYPE_KINDS.get(t) ?? "opaque";
}

const SYSTEM_SCHEMAS = `('pg_catalog', 'information_schema', 'pg_toast')`;

/** Compile-only: Drizzle's Postgres compiler. Never opens a connection. */
let compiler: SqlCompiler | null = null;

export const postgresDialect: Dialect = {
  id: "postgres",
  engines: ["postgres"],
  supportsSchemas: true,
  supportsTransactions: true,
  defaultSchema: "public",

  wireProtocol: "postgres",

  compiler: () => (compiler ??= new PgDialect()),

  castToText: (expr) => sql`${expr}::text`,
  caseInsensitiveLike: (expr, pattern, negate) =>
    negate ? sql`${expr} NOT ILIKE ${pattern}` : sql`${expr} ILIKE ${pattern}`,
  orderByTerm: (column, direction, nulls) => {
    const dir = direction === "asc" ? sql`ASC` : sql`DESC`;
    if (nulls === null) return sql`${column} ${dir}`;
    return nulls === "first" ? sql`${column} ${dir} NULLS FIRST` : sql`${column} ${dir} NULLS LAST`;
  },

  // `default_transaction_read_only` is a server-side session default, sent as a
  // startup parameter, so every statement on the connection inherits it and no
  // client-side check is load-bearing.
  // null, deliberately — NOT `-c default_transaction_read_only=on`. That was a
  // startup parameter, and transaction-mode poolers (Neon, PgBouncer) refuse
  // every startup option, which locked the workbench out of pooled databases.
  // Read-only rides the same path as MySQL instead: runOnConnection wraps each
  // read in a server-enforced READ ONLY transaction.
  readOnlyConnectionParams: () => null,
  classifyType: classifyPostgresType,

  introspection: {
    schemas: `
      SELECT nspname AS schema
      FROM pg_catalog.pg_namespace
      WHERE nspname NOT IN ${SYSTEM_SCHEMAS} AND nspname NOT LIKE 'pg_temp%'
      ORDER BY nspname
    `,
    // reltuples is -1 when the table has never been analysed; normalised to
    // NULL here so the client renders "unknown" instead of a nonsense count.
    tables: `
      SELECT n.nspname AS schema,
             c.relname AS name,
             CASE c.relkind
               WHEN 'r' THEN 'table' WHEN 'p' THEN 'table'
               WHEN 'v' THEN 'view'  WHEN 'm' THEN 'materialized_view'
               WHEN 'f' THEN 'foreign_table' ELSE 'table'
             END AS kind,
             NULLIF(c.reltuples, -1)::bigint AS estimated_rows,
             pg_total_relation_size(c.oid)::bigint AS size_bytes,
             obj_description(c.oid, 'pg_class') AS comment
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r','p','v','m','f')
        AND n.nspname NOT IN ${SYSTEM_SCHEMAS}
        AND n.nspname NOT LIKE 'pg_temp%'
      ORDER BY n.nspname, c.relname
    `,
    // One round trip for every column in the schema, with the primary-key flag,
    // the single-column FK target and the enum labels folded in — three things
    // the current viewer either fetches separately or does without.
    columns: `
      SELECT n.nspname                                  AS schema,
             c.relname                                  AS table_name,
             a.attname                                  AS name,
             format_type(a.atttypid, a.atttypmod)       AS data_type,
             NOT a.attnotnull                           AS nullable,
             a.attnum                                   AS position,
             pg_get_expr(d.adbin, d.adrelid)            AS default_expr,
             COALESCE(pk.is_pk, false)                  AS is_primary_key,
             COALESCE(pk.is_pk, false) OR COALESCE(uq.is_uq, false) AS is_unique,
             (a.attidentity <> '' OR a.attgenerated <> '' OR
              pg_get_expr(d.adbin, d.adrelid) LIKE 'nextval(%') AS is_generated,
             fk.ref_schema, fk.ref_table, fk.ref_column,
             e.labels                                   AS enum_values,
             col_description(c.oid, a.attnum)           AS comment
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c     ON c.oid = a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
      LEFT JOIN LATERAL (
        SELECT true AS is_pk
        FROM pg_catalog.pg_constraint pc
        WHERE pc.conrelid = c.oid AND pc.contype = 'p' AND a.attnum = ANY(pc.conkey)
        LIMIT 1
      ) pk ON true
      LEFT JOIN LATERAL (
        SELECT true AS is_uq
        FROM pg_catalog.pg_constraint uc
        WHERE uc.conrelid = c.oid AND uc.contype = 'u'
          AND array_length(uc.conkey, 1) = 1 AND uc.conkey[1] = a.attnum
        LIMIT 1
      ) uq ON true
      LEFT JOIN LATERAL (
        SELECT rn.nspname AS ref_schema, rc.relname AS ref_table, ra.attname AS ref_column
        FROM pg_catalog.pg_constraint fc
        JOIN pg_catalog.pg_class rc     ON rc.oid = fc.confrelid
        JOIN pg_catalog.pg_namespace rn ON rn.oid = rc.relnamespace
        JOIN pg_catalog.pg_attribute ra ON ra.attrelid = fc.confrelid AND ra.attnum = fc.confkey[1]
        WHERE fc.conrelid = c.oid AND fc.contype = 'f'
          AND array_length(fc.conkey, 1) = 1 AND fc.conkey[1] = a.attnum
        LIMIT 1
      ) fk ON true
      LEFT JOIN LATERAL (
        SELECT array_agg(en.enumlabel ORDER BY en.enumsortorder) AS labels
        FROM pg_catalog.pg_enum en WHERE en.enumtypid = a.atttypid
      ) e ON true
      WHERE a.attnum > 0 AND NOT a.attisdropped
        AND c.relkind IN ('r','p','v','m','f')
        AND n.nspname NOT IN ${SYSTEM_SCHEMAS}
      ORDER BY n.nspname, c.relname, a.attnum
    `,
    indexes: `
      SELECT n.nspname AS schema, c.relname AS table_name, ic.relname AS name,
             i.indisunique AS is_unique, i.indisprimary AS is_primary,
             pg_get_indexdef(i.indexrelid) AS definition,
             pg_relation_size(i.indexrelid)::bigint AS size_bytes,
             ARRAY(
               SELECT pg_get_indexdef(i.indexrelid, k + 1, true)
               FROM generate_subscripts(i.indkey, 1) AS k ORDER BY k
             ) AS columns
      FROM pg_catalog.pg_index i
      JOIN pg_catalog.pg_class c     ON c.oid = i.indrelid
      JOIN pg_catalog.pg_class ic    ON ic.oid = i.indexrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname NOT IN ${SYSTEM_SCHEMAS}
      ORDER BY n.nspname, c.relname, ic.relname
    `,
    constraints: `
      SELECT n.nspname AS schema, c.relname AS table_name, con.conname AS name,
             CASE con.contype
               WHEN 'p' THEN 'primary_key' WHEN 'f' THEN 'foreign_key'
               WHEN 'u' THEN 'unique'      WHEN 'c' THEN 'check'
               WHEN 'x' THEN 'exclusion'   ELSE 'check'
             END AS type,
             pg_get_constraintdef(con.oid) AS definition,
             rn.nspname AS ref_schema, rc.relname AS ref_table,
             ARRAY(
               SELECT att.attname FROM unnest(con.conkey) AS ck(attnum)
               JOIN pg_catalog.pg_attribute att
                 ON att.attrelid = con.conrelid AND att.attnum = ck.attnum
             ) AS columns
      FROM pg_catalog.pg_constraint con
      JOIN pg_catalog.pg_class c     ON c.oid = con.conrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_catalog.pg_class rc     ON rc.oid = con.confrelid
      LEFT JOIN pg_catalog.pg_namespace rn ON rn.oid = rc.relnamespace
      WHERE n.nspname NOT IN ${SYSTEM_SCHEMAS}
      ORDER BY n.nspname, c.relname, con.conname
    `,
    enums: `
      SELECT n.nspname AS schema, t.typname AS name,
             array_agg(e.enumlabel ORDER BY e.enumsortorder) AS values
      FROM pg_catalog.pg_type t
      JOIN pg_catalog.pg_enum e      ON e.enumtypid = t.oid
      JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname NOT IN ${SYSTEM_SCHEMAS}
      GROUP BY n.nspname, t.typname
      ORDER BY n.nspname, t.typname
    `,
  },
};
