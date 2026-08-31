import { sql } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";

/**
 * MySQL / MariaDB dialect. One wire protocol, one `information_schema`, so one
 * dialect serves both — which is the entire reason `mariadb/table-browser.tsx`
 * gets deleted rather than ported.
 *
 * Two shapes differ from Postgres and drive most of what follows:
 *   - There are no schemas *inside* a database. `information_schema.SCHEMATA`
 *     lists databases, so `schema` here means "database", and the connection's
 *     own database is the default.
 *   - `ORDER BY … NULLS LAST` is not supported before MySQL 8.0.31, so null
 *     placement is emitted as the portable `ISNULL(x)` prefix instead.
 */
import type { Dialect, SqlCompiler } from "../dialect";
import type { CellKind } from "../value";

/**
 * `COLUMN_TYPE` is the full declaration, not a bare type name: MySQL reports
 * `bigint(20) unsigned`, `int unsigned zerofill`, `decimal(10,2)`. Strip the
 * display width and the numeric attributes, neither of which changes the family.
 * `double precision` survives because only the known attribute words are cut.
 */
const NUMERIC_ATTRIBUTES = new Set(["unsigned", "signed", "zerofill"]);

function baseType(dataType: string): string {
  const lower = dataType.trim().toLowerCase();
  const paren = lower.indexOf("(");
  const withoutWidth = paren === -1 ? lower : lower.slice(0, paren);
  return withoutWidth
    .split(/\s+/)
    .filter((word) => word !== "" && !NUMERIC_ATTRIBUTES.has(word))
    .join(" ");
}

const MYSQL_TYPE_KINDS: ReadonlyMap<string, CellKind> = new Map([
  ["bool", "bool"],
  ["boolean", "bool"],

  ["smallint", "number"],
  ["mediumint", "number"],
  ["int", "number"],
  ["integer", "number"],
  ["float", "number"],
  ["double", "number"],
  ["double precision", "number"],
  ["year", "number"],

  ["bigint", "bigint"],

  ["decimal", "decimal"],
  ["numeric", "decimal"],
  ["dec", "decimal"],
  ["fixed", "decimal"],

  ["json", "json"],

  ["binary", "bytes"],
  ["varbinary", "bytes"],
  ["tinyblob", "bytes"],
  ["blob", "bytes"],
  ["mediumblob", "bytes"],
  ["longblob", "bytes"],

  // MySQL stores TIMESTAMP as UTC and converts on read: a real instant.
  // DATETIME carries no zone, so it is a wall-clock value instead.
  ["timestamp", "instant"],
  ["datetime", "date"],
  ["date", "date"],
  ["time", "time"],

  ["char", "text"],
  ["varchar", "text"],
  ["tinytext", "text"],
  ["text", "text"],
  ["mediumtext", "text"],
  ["longtext", "text"],
  ["uuid", "text"],
  ["enum", "text"],
  ["set", "text"],
]);

export function classifyMysqlType(dataType: string): CellKind {
  const raw = dataType.trim().toLowerCase();
  const t = baseType(raw);
  // MySQL has no boolean type. `tinyint(1)` is the universal convention for
  // one, and every ORM in the ecosystem writes it that way.
  if (t === "tinyint") return raw.startsWith("tinyint(1)") ? "bool" : "number";
  return MYSQL_TYPE_KINDS.get(t) ?? "opaque";
}

const SYSTEM_SCHEMAS = `('information_schema', 'performance_schema', 'mysql', 'sys')`;

/** Compile-only: a real MySQL compiler over a driver that never connects. */
let compiler: SqlCompiler | null = null;

export const mysqlDialect: Dialect = {
  id: "mysql",
  engines: ["mariadb"],
  // A MySQL "schema" IS a database; there is no second level to browse.
  supportsSchemas: true,
  supportsTransactions: true,
  defaultSchema: "",

  wireProtocol: "mysql",

  compiler: () => (compiler ??= new MySqlDialect()),

  castToText: (expr) => sql`CAST(${expr} AS CHAR)`,
  // MySQL's default collations are already case-insensitive, so a plain LIKE
  // gives the behaviour Postgres needs ILIKE for — and ILIKE is a syntax error here.
  caseInsensitiveLike: (expr, pattern, negate) =>
    negate ? sql`${expr} NOT LIKE ${pattern}` : sql`${expr} LIKE ${pattern}`,
  orderByTerm: (column, direction, nulls) => {
    const dir = direction === "asc" ? sql`ASC` : sql`DESC`;
    if (nulls === null) return sql`${column} ${dir}`;
    // Portable NULLS FIRST/LAST: sort on null-ness first. Works on every MySQL
    // and MariaDB, unlike the native 8.0.31+ syntax.
    const nullsDir = nulls === "first" ? sql`DESC` : sql`ASC`;
    return sql`ISNULL(${column}) ${nullsDir}, ${column} ${dir}`;
  },

  readOnlyConnectionParams: () => null,
  classifyType: classifyMysqlType,

  introspection: {
    schemas: `
      SELECT SCHEMA_NAME AS \`schema\`
      FROM information_schema.SCHEMATA
      WHERE SCHEMA_NAME NOT IN ${SYSTEM_SCHEMAS}
      ORDER BY SCHEMA_NAME
    `,
    tables: `
      SELECT TABLE_SCHEMA AS \`schema\`,
             TABLE_NAME   AS name,
             CASE TABLE_TYPE WHEN 'VIEW' THEN 'view' ELSE 'table' END AS kind,
             TABLE_ROWS   AS estimated_rows,
             (COALESCE(DATA_LENGTH,0) + COALESCE(INDEX_LENGTH,0)) AS size_bytes,
             TABLE_COMMENT AS comment
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA NOT IN ${SYSTEM_SCHEMAS}
      ORDER BY TABLE_SCHEMA, TABLE_NAME
    `,
    // COLUMN_KEY='PRI' is the primary-key flag; EXTRA carries auto_increment and
    // generated columns. The single-column FK is joined from KEY_COLUMN_USAGE.
    columns: `
      SELECT c.TABLE_SCHEMA AS \`schema\`,
             c.TABLE_NAME   AS table_name,
             c.COLUMN_NAME  AS name,
             c.COLUMN_TYPE  AS data_type,
             (c.IS_NULLABLE = 'YES')      AS nullable,
             c.ORDINAL_POSITION           AS position,
             c.COLUMN_DEFAULT             AS default_expr,
             (c.COLUMN_KEY = 'PRI')       AS is_primary_key,
             (c.COLUMN_KEY IN ('PRI', 'UNI')) AS is_unique,
             (c.EXTRA LIKE '%auto_increment%' OR c.EXTRA LIKE '%GENERATED%') AS is_generated,
             k.REFERENCED_TABLE_SCHEMA    AS ref_schema,
             k.REFERENCED_TABLE_NAME      AS ref_table,
             k.REFERENCED_COLUMN_NAME     AS ref_column,
             c.COLUMN_COMMENT             AS comment
      FROM information_schema.COLUMNS c
      LEFT JOIN information_schema.KEY_COLUMN_USAGE k
        ON  k.TABLE_SCHEMA = c.TABLE_SCHEMA
        AND k.TABLE_NAME   = c.TABLE_NAME
        AND k.COLUMN_NAME  = c.COLUMN_NAME
        AND k.REFERENCED_TABLE_NAME IS NOT NULL
      WHERE c.TABLE_SCHEMA NOT IN ${SYSTEM_SCHEMAS}
      ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION
    `,
    indexes: `
      SELECT TABLE_SCHEMA AS \`schema\`, TABLE_NAME AS table_name,
             INDEX_NAME AS name,
             (NON_UNIQUE = 0) AS is_unique,
             (INDEX_NAME = 'PRIMARY') AS is_primary,
             NULL AS definition, NULL AS size_bytes,
             GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columns
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA NOT IN ${SYSTEM_SCHEMAS}
      GROUP BY TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, NON_UNIQUE
      ORDER BY TABLE_SCHEMA, TABLE_NAME, INDEX_NAME
    `,
    constraints: `
      SELECT t.CONSTRAINT_SCHEMA AS \`schema\`, t.TABLE_NAME AS table_name,
             t.CONSTRAINT_NAME AS name,
             CASE t.CONSTRAINT_TYPE
               WHEN 'PRIMARY KEY' THEN 'primary_key'
               WHEN 'FOREIGN KEY' THEN 'foreign_key'
               WHEN 'UNIQUE'      THEN 'unique'
               ELSE 'check'
             END AS type,
             NULL AS definition,
             MAX(k.REFERENCED_TABLE_SCHEMA) AS ref_schema,
             MAX(k.REFERENCED_TABLE_NAME)   AS ref_table,
             GROUP_CONCAT(k.COLUMN_NAME ORDER BY k.ORDINAL_POSITION) AS columns
      FROM information_schema.TABLE_CONSTRAINTS t
      LEFT JOIN information_schema.KEY_COLUMN_USAGE k
        ON  k.CONSTRAINT_SCHEMA = t.CONSTRAINT_SCHEMA
        AND k.CONSTRAINT_NAME   = t.CONSTRAINT_NAME
        AND k.TABLE_NAME        = t.TABLE_NAME
      WHERE t.CONSTRAINT_SCHEMA NOT IN ${SYSTEM_SCHEMAS}
      GROUP BY t.CONSTRAINT_SCHEMA, t.TABLE_NAME, t.CONSTRAINT_NAME, t.CONSTRAINT_TYPE
      ORDER BY t.CONSTRAINT_SCHEMA, t.TABLE_NAME, t.CONSTRAINT_NAME
    `,
    // MySQL enums are an inline column type, not a catalog object; the column
    // introspection above already carries the full `enum('a','b')` in COLUMN_TYPE.
    enums: null,
  },
};
