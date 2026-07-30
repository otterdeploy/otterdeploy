/**
 * Pure shaping + SQL construction for the MariaDB/MySQL data viewer. Split out
 * of `mariadb.ts` (which owns the Docker exec plumbing) so every parser and
 * statement builder here is a leaf that unit-tests without a container.
 *
 * Two things this module is responsible for keeping honest:
 *  - `mysql --batch` output is tab-delimited with backslash escapes and `\N`
 *    for SQL NULL. Splitting on tab is only correct BEFORE unescaping, because
 *    an embedded tab arrives as the two characters `\` `t`.
 *  - every identifier the client supplies (schema/table) is backtick-quoted and
 *    every value is a single-quoted literal, so nothing here can be injected.
 */

/** System schemas hidden from the browser. */
export const SYSTEM_SCHEMAS = ["information_schema", "mysql", "performance_schema", "sys"];

/**
 * Client binaries we accept, in preference order.
 *
 * The MariaDB Docker Official Image dropped the `mysql*` symlinks at 11.0 —
 * the client is `mariadb` now — and we provision `mariadb:12` / `mariadb:11.4`
 * by default, so hardcoding `mysql` failed with "executable file not found"
 * against every MariaDB we ship. We still probe for `mysql` second because
 * `engineFromImage` maps genuine `mysql:*` images onto this same engine, and
 * those have only the MySQL-named client.
 */
export const CLIENT_CANDIDATES = ["mariadb", "mysql"] as const;

/** `sh -c` snippet that prints the first available client's absolute path. */
export const CLIENT_PROBE_SCRIPT = CLIENT_CANDIDATES.map(
  (bin) => `command -v ${bin} 2>/dev/null`,
).join(" || ");

/** First non-empty line of the probe's stdout — the client's absolute path. */
export function pickClientPath(stdout: string): string | null {
  for (const line of stdout.split("\n")) {
    const path = line.trim();
    if (path !== "") return path;
  }
  return null;
}

/** Quote a MySQL identifier with backticks (internal backticks doubled). */
export function quoteIdent(name: string): string {
  return `\`${name.replace(/`/g, "``")}\``;
}

/**
 * Render a string as a SQL literal. Unlike Postgres, MySQL/MariaDB treat
 * backslash as an escape character inside string literals by default, so
 * doubling the quote alone is not enough — `\` must be doubled too.
 */
export function sqlString(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

/** Parse `mysql --batch` output (tab-delimited, escaped) into raw cells. Cells
 *  are left ESCAPED — split on tab first, then unescape each field. */
export function parseBatch(out: string): { columns: string[]; rows: string[][] } {
  const lines = out.replace(/\n$/, "").split("\n");
  if (lines.length === 0 || (lines.length === 1 && lines[0] === "")) {
    return { columns: [], rows: [] };
  }
  const split = (line: string) => line.split("\t");
  const columns = split(lines[0] ?? "").map((c) => unescapeCell(c) ?? c);
  return { columns, rows: lines.slice(1).map(split) };
}

/** Unescape one `mysql --batch` field. `\N` (exactly) is SQL NULL; control
 *  chars are backslash-escaped (`\t` `\n` `\0` `\\`). */
export function unescapeCell(field: string): string | null {
  if (field === "\\N") return null;
  return field.replace(/\\([tn0\\])/g, (_, c: string) =>
    c === "t" ? "\t" : c === "n" ? "\n" : c === "0" ? "\0" : "\\",
  );
}

// ── Statement builders ──────────────────────────────────────────────────────

/**
 * User tables plus `table_rows`, the engine's own row estimate. For InnoDB
 * that's a sampled estimate (exactly like Postgres's `reltuples` — cheap, and
 * never a `count(*)` that would full-scan a big table on every page load).
 */
export function buildTablesSql(): string {
  const notIn = SYSTEM_SCHEMAS.map(sqlString).join(", ");
  return (
    `SELECT table_schema, table_name, table_rows FROM information_schema.tables ` +
    `WHERE table_schema NOT IN (${notIn}) AND table_type = 'BASE TABLE' ` +
    `ORDER BY table_schema, table_name`
  );
}

/** Primary-key columns in index order — used to make paging deterministic. */
export function buildPrimaryKeySql(schema: string, table: string): string {
  return (
    `SELECT column_name FROM information_schema.statistics ` +
    `WHERE table_schema = ${sqlString(schema)} AND table_name = ${sqlString(table)} ` +
    `AND index_name = 'PRIMARY' ORDER BY seq_in_index`
  );
}

/**
 * One page of a table's rows.
 *
 * `LIMIT/OFFSET` without an ORDER BY is not stable — the server may return rows
 * in a different order between pages, so a plain `SELECT *` browser can show
 * the same row twice and skip another. When the table has a primary key we sort
 * by it; without one there is nothing to sort by that we can trust, so we page
 * unordered rather than invent a key.
 *
 * Fetches `limit + 1` so the caller can detect a next page without a COUNT(*).
 */
export function buildBrowseSql(opts: {
  schema: string;
  table: string;
  pk: string[];
  limit: number;
  offset: number;
}): string {
  const target = `${quoteIdent(opts.schema)}.${quoteIdent(opts.table)}`;
  const orderBy = opts.pk.length > 0 ? ` ORDER BY ${opts.pk.map(quoteIdent).join(", ")}` : "";
  return `SELECT * FROM ${target}${orderBy} LIMIT ${opts.limit + 1} OFFSET ${opts.offset}`;
}

// ── Result shaping ──────────────────────────────────────────────────────────

export interface MariadbTable {
  schema: string;
  name: string;
  /** Engine row estimate; null when the engine doesn't report one. */
  estimatedRows: number | null;
}

/** Parse `table_rows`: NULL or a negative/garbage value → unknown. */
export function parseEstimatedRows(cell: string | null): number | null {
  if (cell == null) return null;
  const n = Number(cell);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Shape `buildTablesSql` output into the contract's table list. */
export function shapeTables(out: string): MariadbTable[] {
  return parseBatch(out).rows.map((r) => ({
    schema: unescapeCell(r[0] ?? "") ?? "",
    name: unescapeCell(r[1] ?? "") ?? "",
    estimatedRows: parseEstimatedRows(unescapeCell(r[2] ?? "\\N")),
  }));
}

/** Shape `buildPrimaryKeySql` output into an ordered column-name list. */
export function shapePrimaryKey(out: string): string[] {
  return parseBatch(out)
    .rows.map((r) => unescapeCell(r[0] ?? "") ?? "")
    .filter((c) => c !== "");
}

export interface MariadbGrid {
  columns: string[];
  rows: Array<Array<string | null>>;
  /** True when another page exists (we fetched `limit + 1`). */
  hasMore: boolean;
}

/** Shape `buildBrowseSql` output into the viewer grid, trimming the probe row. */
export function shapeGrid(out: string, limit: number): MariadbGrid {
  const { columns, rows } = parseBatch(out);
  return {
    columns,
    rows: rows.slice(0, limit).map((r) => r.map(unescapeCell)),
    hasMore: rows.length > limit,
  };
}
