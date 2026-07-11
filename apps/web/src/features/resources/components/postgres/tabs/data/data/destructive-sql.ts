/**
 * Classifies a write-mode SQL buffer for the confirm dialog: `destructive`
 * statements (DROP / TRUNCATE / unscoped DELETE / unscoped UPDATE) get the
 * type-the-database-name gate; everything else gets a plain styled confirm.
 *
 * Deliberately a simple lexical heuristic, not a parser — comments and
 * single-quoted strings are stripped first so literals can't false-positive,
 * then each `;`-separated statement is checked by its leading keyword. A CTE
 * that fans into a DELETE (`WITH … DELETE`) is missed by design; it still
 * lands on the normal write confirm, never on silent execution.
 */

export type WriteSeverity = "destructive" | "write";

// Remove SQL comments (line + block) and single-quoted strings so the
// keyword checks only see real syntax.
function stripLiteralsAndComments(sql: string): string {
  return sql
    .replace(/'(?:[^']|'')*'/g, "''") // quoted strings (incl. '' escapes)
    .replace(/--[^\n]*/g, " ") // line comments
    .replace(/\/\*[\s\S]*?\*\//g, " "); // block comments
}

/** Is a single (already stripped) statement destructive? */
export function isDestructiveStatement(statement: string): boolean {
  const s = statement.trim().toLowerCase();
  if (s.length === 0) return false;
  if (/^(drop|truncate)\b/.test(s)) return true;
  // DELETE / UPDATE with no WHERE clause hit every row in the table.
  if (/^(delete|update)\b/.test(s) && !/\bwhere\b/.test(s)) return true;
  return false;
}

/** Severity for a whole editor buffer: destructive if ANY statement is. */
export function classifyWriteSql(sql: string): WriteSeverity {
  const statements = stripLiteralsAndComments(sql).split(";");
  return statements.some(isDestructiveStatement) ? "destructive" : "write";
}
