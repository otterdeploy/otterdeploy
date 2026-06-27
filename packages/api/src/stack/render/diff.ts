/**
 * Hand-rolled minimal unified-diff over lines. Sufficient for the canary
 * endpoint — operators only need to see "what would change if we applied
 * the renderer's output". The output mirrors `diff -u` format closely
 * enough for editor / GitHub viewers to render with syntax highlighting.
 *
 * Uses an LCS-based row diff. Both inputs are bounded by the size of a
 * single stack file (KBs), so O(n*m) is fine in practice.
 */

function lcsTable(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      const row = dp[i + 1] ?? [];
      const cur = dp[i] ?? [];
      cur[j] = a[i] === b[j] ? (row[j + 1] ?? 0) + 1 : Math.max(row[j] ?? 0, cur[j + 1] ?? 0);
    }
  }
  return dp;
}

interface Op {
  kind: "ctx" | "add" | "del";
  line: string;
}

interface Cursor {
  i: number;
  j: number;
}

function pickOp(a: string[], b: string[], dp: number[][], cur: Cursor): Op {
  const { i, j } = cur;
  if (a[i] === b[j]) {
    cur.i++;
    cur.j++;
    return { kind: "ctx", line: a[i] ?? "" };
  }
  if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
    cur.i++;
    return { kind: "del", line: a[i] ?? "" };
  }
  cur.j++;
  return { kind: "add", line: b[j] ?? "" };
}

function buildOps(a: string[], b: string[]): Op[] {
  const dp = lcsTable(a, b);
  const ops: Op[] = [];
  const cur: Cursor = { i: 0, j: 0 };
  while (cur.i < a.length && cur.j < b.length) {
    ops.push(pickOp(a, b, dp, cur));
  }
  while (cur.i < a.length) ops.push({ kind: "del", line: a[cur.i++] ?? "" });
  while (cur.j < b.length) ops.push({ kind: "add", line: b[cur.j++] ?? "" });
  return ops;
}

export function unifiedDiff(
  prev: string,
  next: string,
  labelPrev = "saved",
  labelNext = "rendered",
): string {
  if (prev === next) return "";
  const a = prev === "" ? [] : prev.split("\n");
  const b = next === "" ? [] : next.split("\n");
  const ops = buildOps(a, b);

  const lines: string[] = [`--- ${labelPrev}`, `+++ ${labelNext}`];
  for (const op of ops) {
    if (op.kind === "ctx") lines.push(` ${op.line}`);
    else if (op.kind === "add") lines.push(`+${op.line}`);
    else lines.push(`-${op.line}`);
  }
  return `${lines.join("\n")}\n`;
}
