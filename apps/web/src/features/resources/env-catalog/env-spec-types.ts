/**
 * Interpret an `@env-spec` `@type=` expression as a value check.
 *
 * Covers the subset the template schemas use — `url`, `email`, `number`,
 * `port`, `boolean`, `enum(a, b)`, and `string(minLength=, startsWith=,
 * matches=/…/)` — and deliberately nothing else. An unrecognised type yields
 * no validator rather than a guess: a schema author who writes `@type=uuid`
 * gets autocomplete and docs for that key, and no shape check, which is
 * honest. Widening this is one case at a time in `checkers` below.
 *
 * Messages are plain English, like the catalog's descriptions: they name the
 * expectation, not the failure, so "expected a URL" reads the same whether
 * the operator typed a bare host or left the field empty.
 */

/** One parsed `@type` call: `name` and its arguments, positional or keyed. */
interface TypeExpr {
  name: string;
  positional: string[];
  keyed: Record<string, string>;
}

/**
 * Split a `@type` argument list on commas, except inside a `/regex/` literal
 * — `string(matches=/^[a-z,]+$/)` has a comma the regex owns.
 */
function splitArgs(inner: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inRegex = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i] ?? "";
    if (ch === "/" && inner[i - 1] !== "\\") inRegex = !inRegex;
    if (ch === "," && !inRegex) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim() !== "") out.push(cur.trim());
  return out;
}

export function parseTypeExpr(expr: string): TypeExpr | null {
  const m = /^\s*([A-Za-z][A-Za-z0-9_-]*)\s*(?:\((.*)\))?\s*$/s.exec(expr);
  if (!m?.[1]) return null;
  const name = m[1];
  const positional: string[] = [];
  const keyed: Record<string, string> = {};
  for (const arg of m[2] ? splitArgs(m[2]) : []) {
    const eq = arg.indexOf("=");
    if (eq > 0 && !arg.startsWith("/")) {
      keyed[arg.slice(0, eq).trim()] = unquote(arg.slice(eq + 1).trim());
    } else {
      positional.push(unquote(arg));
    }
  }
  return { name, positional, keyed };
}

function unquote(v: string): string {
  return /^(["']).*\1$/s.test(v) ? v.slice(1, -1) : v;
}

/** `/pattern/flags` → RegExp; a bare string is a pattern with no flags. */
function toRegExp(v: string): RegExp | null {
  const lit = /^\/(.*)\/([a-z]*)$/s.exec(v);
  const attempt = lit ? [lit[1] ?? "", lit[2] ?? ""] : [v, ""];
  try {
    return new RegExp(attempt[0] ?? "", attempt[1]);
  } catch {
    return null;
  }
}

/** A check returns the expectation the value failed, or null. */
export type ValueCheck = (value: string) => string | null;

const checkers: Record<string, (t: TypeExpr) => ValueCheck | null> = {
  url: () => (v) => {
    try {
      const u = new URL(v);
      return u.protocol === "http:" || u.protocol === "https:" ? null : "expected an http(s) URL";
    } catch {
      return "expected a URL, scheme included";
    }
  },
  email: () => (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : "expected an email address"),
  number: () => (v) => (v.trim() !== "" && Number.isFinite(Number(v)) ? null : "expected a number"),
  port: () => (v) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= 65535 ? null : "expected a port (1–65535)";
  },
  boolean: () => (v) =>
    /^(true|false|1|0|yes|no)$/i.test(v.trim()) ? null : "expected true or false",
  enum: (t) => {
    const allowed = t.positional;
    if (allowed.length === 0) return null;
    return (v) => (allowed.includes(v) ? null : `expected one of: ${allowed.join(", ")}`);
  },
  string: (t) => {
    const rules: ValueCheck[] = [];
    const min = t.keyed.minLength;
    if (min !== undefined && Number.isFinite(Number(min))) {
      const n = Number(min);
      rules.push((v) => (v.length >= n ? null : `must be at least ${n} characters`));
    }
    const prefix = t.keyed.startsWith;
    if (prefix !== undefined) {
      rules.push((v) => (v.startsWith(prefix) ? null : `must start with ${prefix}`));
    }
    const pattern = t.keyed.matches;
    if (pattern !== undefined) {
      const re = toRegExp(pattern);
      if (re) rules.push((v) => (re.test(v) ? null : `must match ${pattern}`));
    }
    if (rules.length === 0) return null;
    return (v) => {
      for (const rule of rules) {
        const issue = rule(v);
        if (issue) return issue;
      }
      return null;
    };
  },
};

/** The check for a `@type` expression, or null when it isn't one we judge. */
export function checkForType(expr: string): ValueCheck | null {
  const parsed = parseTypeExpr(expr);
  if (!parsed) return null;
  return checkers[parsed.name]?.(parsed) ?? null;
}
