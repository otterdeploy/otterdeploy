/**
 * Split a SQL buffer into individual statements so each one gets its own
 * run-gutter ▶ and ⌘↵ runs only the statement under the cursor. The splitter
 * walks the text tracking line/block comments, single/double-quoted literals,
 * and Postgres dollar-quoting ($$ … $$ / $tag$ … $tag$) so a `;` inside any of
 * those never ends a statement.
 *
 * `from` points at the first real SQL token (leading comments/whitespace are
 * skipped — that's where the ▶ lands, matching the studio reference), and
 * `text` is that token through the statement's end.
 */
export interface SqlStatement {
  /** Offset of the first non-comment, non-whitespace char. */
  from: number;
  /** Offset just past the last non-whitespace char (before the `;`). */
  to: number;
  /** The runnable statement text (leading comments stripped). */
  text: string;
}

const WS = /\s/;

/** Skip whitespace and leading comments from `i`, returning the first code offset. */
function codeStart(sql: string, i: number, end: number): number {
  while (i < end) {
    const c = sql[i];
    if (c && WS.test(c)) {
      i++;
      continue;
    }
    if (c === "-" && sql[i + 1] === "-") {
      i += 2;
      while (i < end && sql[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < end && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    break;
  }
  return i;
}

/** True when, after stripping comments, nothing but whitespace remains. */
function isOnlyComments(text: string): boolean {
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
  return stripped.trim().length === 0;
}

/** Advance past a `-- line comment` opened at `i`; returns the index past it. */
function skipLineComment(sql: string, i: number, n: number): number {
  i += 2;
  while (i < n && sql[i] !== "\n") i++;
  return i;
}

/** Advance past a `/* block comment *\/` opened at `i`. */
function skipBlockComment(sql: string, i: number, n: number): number {
  i += 2;
  while (i < n && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
  return i + 2;
}

/** Advance past a single/double-quoted literal opened at `i` (doubled-quote escapes). */
function skipQuoted(sql: string, i: number, n: number): number {
  const q = sql[i];
  i++;
  while (i < n) {
    if (sql[i] === q) {
      if (sql[i + 1] === q) {
        i += 2; // doubled quote escape
        continue;
      }
      return i + 1;
    }
    i++;
  }
  return i;
}

/** If a dollar-quote tag opens at `i`, advance past the whole block; else `-1`. */
function skipDollarQuote(sql: string, i: number, n: number): number {
  const m = /^\$[A-Za-z0-9_]*\$/.exec(sql.slice(i));
  if (!m) return -1;
  const tag = m[0];
  const close = sql.indexOf(tag, i + tag.length);
  return close === -1 ? n : close + tag.length;
}

export function splitStatements(sql: string): SqlStatement[] {
  const out: SqlStatement[] = [];
  const n = sql.length;
  let i = 0;
  let stmtStart = 0;

  const flush = (start: number, end: number) => {
    // Trim trailing whitespace.
    let e = end;
    while (e > start && WS.test(sql[e - 1] ?? "")) e--;
    const from = codeStart(sql, start, e);
    if (e <= from) return; // empty
    const text = sql.slice(from, e);
    if (isOnlyComments(text)) return;
    out.push({ from, to: e, text });
  };

  while (i < n) {
    const c = sql[i];
    const c2 = sql[i + 1];

    if (c === "-" && c2 === "-") {
      i = skipLineComment(sql, i, n);
      continue;
    }
    if (c === "/" && c2 === "*") {
      i = skipBlockComment(sql, i, n);
      continue;
    }
    if (c === "'" || c === '"') {
      i = skipQuoted(sql, i, n);
      continue;
    }
    if (c === "$") {
      const next = skipDollarQuote(sql, i, n);
      if (next !== -1) {
        i = next;
        continue;
      }
    }
    if (c === ";") {
      flush(stmtStart, i);
      i++;
      stmtStart = i;
      continue;
    }
    i++;
  }
  flush(stmtStart, n);
  return out;
}
