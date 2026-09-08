/**
 * The command palette's filter grammar.
 *
 * `outcome:denied action:project.create,project.delete latency:100-500`
 *
 * One line of text that means exactly what the sidebar means, because both
 * write the same filter values. That is the property this module exists to
 * hold: typing a query and building the same filter by clicking must produce
 * byte-identical URLs, or the palette is a second filter system rather than a
 * faster way into the first.
 *
 * Rules worth knowing:
 *
 * - **Split on the FIRST colon.** Values contain colons — timestamps, URLs,
 *   RPC paths — and splitting on all of them truncates the value at the second.
 * - **Quotes for spaces.** `reason:"not a member"` is one value; without the
 *   quotes it is a value and a stray word.
 * - **A value the declaration cannot use is dropped, not guessed at.** The same
 *   `coerce` the URL and the server use runs over the parsed result.
 */

import { asText, defineFilters, type FilterSpec } from "@otterdeploy/shared/table-filters";

/** Members of a multi-select, in one token: `regions:ams,fra`. */
const UNION = ",";
/** The two ends of a range, in one token: `latency:100-500`. */
const RANGE = "-";

/** `key:value` pairs, honouring quotes around a value with spaces. */
const TOKEN = /([\w.]+):(?:"([^"]*)"|'([^']*)'|(\S+))/g;

export interface Token {
  key: string;
  value: string;
}

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  for (const match of input.matchAll(TOKEN)) {
    const key = match[1];
    const value = match[2] ?? match[3] ?? match[4];
    if (key && value !== undefined) tokens.push({ key, value });
  }
  return tokens;
}

/** One token's text → the value shape that filter type carries. */
function valueOf(spec: FilterSpec, text: string): unknown {
  switch (spec.type) {
    case "checkbox":
      return text.split(UNION).filter((part) => part !== "");
    case "slider": {
      const [low, high] = text.split(RANGE);
      // A single number is a point, which for a range means [n, n] — the same
      // reading `normalize` gives a one-handle slider.
      const min = Number(low);
      const max = high === undefined || high === "" ? min : Number(high);
      return [min, max];
    }
    case "timerange": {
      const [from, to] = text.split(RANGE);
      return [Number(from), Number(to ?? from)];
    }
    case "input":
    case "search":
      return text;
  }
}

/**
 * A query line → filter values.
 *
 * Runs the parsed tokens through `coerce`, so an unknown key, an enum member
 * that does not exist, or an out-of-bounds range is dropped here exactly as it
 * would be if it had arrived in the URL.
 */
export function parseQuery(input: string, specs: readonly FilterSpec[]): Record<string, unknown> {
  const byKey = new Map(specs.map((spec) => [spec.key, spec]));
  const raw: Record<string, unknown> = {};
  for (const token of tokenize(input)) {
    const spec = byKey.get(token.key);
    if (!spec) continue;
    raw[token.key] = valueOf(spec, token.value);
  }
  return defineFilters(specs).coerce(raw);
}

/** Quote a value that would otherwise be read as two tokens. */
function quote(text: string): string {
  return text.includes(" ") ? `"${text}"` : text;
}

function tokenTextOf(spec: FilterSpec, value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  switch (spec.type) {
    case "checkbox": {
      const members = Array.isArray(value) ? value : [value];
      const text = members.map((member) => String(member)).join(UNION);
      return text === "" ? null : text;
    }
    case "slider":
    case "timerange": {
      if (!Array.isArray(value) || value.length !== 2) return null;
      return `${String(value[0])}${RANGE}${String(value[1])}`;
    }
    case "input":
    case "search":
      // `asText` returns null for anything that has no readable text form, so
      // a value that cannot be typed back into the line is left out of it.
      return asText(value);
  }
}

/**
 * Filter values → a query line.
 *
 * The inverse of `parseQuery` for everything the palette can express. A filter
 * the palette cannot express (a timerange, normally) is left out rather than
 * rendered as an epoch pair nobody can read or edit — see `commandKeys`.
 */
export function serializeQuery(
  values: Record<string, unknown>,
  specs: readonly FilterSpec[],
): string {
  const parts: string[] = [];
  for (const spec of specs) {
    const text = tokenTextOf(spec, values[spec.key]);
    if (text !== null) parts.push(`${spec.key}:${quote(text)}`);
  }
  return parts.join(" ");
}

/**
 * The span of the word the caret sits in.
 *
 * Both caret operations need the same two boundaries, and computing them in
 * each is how "read the word" and "replace the word" drift into disagreeing
 * about where it starts.
 */
function wordBounds(value: string, caret: number): [number, number] {
  let start = caret;
  let end = caret;
  while (start > 0 && value[start - 1] !== " ") start -= 1;
  while (end < value.length && value[end] !== " ") end += 1;
  return [start, end];
}

/** The word the caret sits in — what completions are offered for. */
export function wordAt(value: string, caret: number): string {
  const [start, end] = wordBounds(value, caret);
  return value.slice(start, end);
}

/** Replace the word under the caret, leaving the rest of the line alone. */
export function replaceWord(value: string, caret: number, replacement: string): string {
  const [start, end] = wordBounds(value, caret);
  return `${value.slice(0, start)}${replacement}${value.slice(end)}`;
}

/** A partly-typed token: `outcome:` or `outcome:den` — key, and value so far. */
export function partialToken(word: string): { key: string; value: string } | null {
  const separator = word.indexOf(":");
  if (separator < 1) return null;
  return { key: word.slice(0, separator), value: word.slice(separator + 1) };
}
