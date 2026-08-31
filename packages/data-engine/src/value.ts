/**
 * The typed cell value that crosses the wire.
 *
 * The old data viewer ran every query through `psql --csv` and handed the UI
 * `Array<Array<string | null>>`. That shape cannot tell SQL NULL from the empty
 * string, turns `jsonb` into text the client has to re-parse, rounds `int8`
 * through `Number`, and renders `bytea` as mojibake. Every one of those is a
 * correctness bug the grid cannot recover from, because the information was
 * destroyed before it left the server.
 *
 * So: one tagged union, parsed (never cast) at both ends.
 *
 *   - JSON `null` is SQL NULL, and *only* SQL NULL. Nothing else encodes to it.
 *   - Exact numerics (`int8`, `numeric`) travel as strings so no digit is lost.
 *     They are still labelled `bigint` / `decimal`, so the grid can right-align
 *     them and the editor can validate them as numbers.
 *   - `bytes` is base64. `json` is the real parsed value, not a string.
 *   - Anything a driver hands us that we don't model degrades to `opaque`
 *     rather than being silently coerced to text — an honest "we don't know"
 *     beats a lossy guess.
 */
import type { JsonValue } from "@otterdeploy/shared/json";

import { Temporal } from "@otterdeploy/shared/temporal";
import { Result } from "better-result";
import * as z from "zod";

/** The type families the grid renders and the editor validates against. */
export const CELL_KINDS = [
  "text",
  "number",
  "bool",
  "bigint",
  "decimal",
  "bytes",
  "json",
  "instant",
  "date",
  "time",
  "array",
  "opaque",
] as const;

export type CellKind = (typeof CELL_KINDS)[number];

export const cellKindSchema = z.enum(CELL_KINDS);

/**
 * One cell. `null` is SQL NULL; everything else carries its kind so the client
 * never has to infer a type from the column name or the shape of a string.
 */
export type CellValue =
  | null
  | { k: "text"; v: string }
  | { k: "number"; v: number }
  | { k: "bool"; v: boolean }
  /** Exact integer wider than `Number.MAX_SAFE_INTEGER`; decimal digits only. */
  | { k: "bigint"; v: string }
  /** Exact fixed-point; the literal as the server printed it. */
  | { k: "decimal"; v: string }
  /** Base64, unpadded or padded — the decoder accepts both. */
  | { k: "bytes"; v: string }
  | { k: "json"; v: JsonValue }
  /** ISO-8601 with an offset. A point on the timeline. */
  | { k: "instant"; v: string }
  /** `YYYY-MM-DD`, no zone. A calendar date is not a point on the timeline. */
  | { k: "date"; v: string }
  /** `HH:MM:SS[.fff]`, no zone. */
  | { k: "time"; v: string }
  | { k: "array"; v: CellValue[] }
  /** A value we can transport but not interpret. Rendered verbatim, read-only. */
  | { k: "opaque"; v: string };

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

/**
 * Runtime schema for a cell. Exported so the oRPC contract parses rows at the
 * boundary instead of trusting them — the repo bans `payload as MyShape`, and
 * this is the payload that would most tempt it.
 */
export const cellValueSchema: z.ZodType<CellValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.object({ k: z.literal("text"), v: z.string() }),
    z.object({ k: z.literal("number"), v: z.number() }),
    z.object({ k: z.literal("bool"), v: z.boolean() }),
    z.object({ k: z.literal("bigint"), v: z.string() }),
    z.object({ k: z.literal("decimal"), v: z.string() }),
    z.object({ k: z.literal("bytes"), v: z.string() }),
    z.object({ k: z.literal("json"), v: jsonValueSchema }),
    z.object({ k: z.literal("instant"), v: z.string() }),
    z.object({ k: z.literal("date"), v: z.string() }),
    z.object({ k: z.literal("time"), v: z.string() }),
    z.object({ k: z.literal("array"), v: z.array(cellValueSchema) }),
    z.object({ k: z.literal("opaque"), v: z.string() }),
  ]),
);

// ── constructors ────────────────────────────────────────────────────────────
// Named so call sites read as intent rather than object literals, and so the
// "is this NULL" decision happens in exactly one place.

export const cellText = (v: string): CellValue => ({ k: "text", v });
export const cellNumber = (v: number): CellValue => ({ k: "number", v });
export const cellBool = (v: boolean): CellValue => ({ k: "bool", v });
export const cellBigint = (v: string): CellValue => ({ k: "bigint", v });
export const cellDecimal = (v: string): CellValue => ({ k: "decimal", v });
export const cellBytes = (v: string): CellValue => ({ k: "bytes", v });
export const cellJson = (v: JsonValue): CellValue => ({ k: "json", v });
export const cellInstant = (v: string): CellValue => ({ k: "instant", v });
export const cellDate = (v: string): CellValue => ({ k: "date", v });
export const cellTime = (v: string): CellValue => ({ k: "time", v });
export const cellArray = (v: CellValue[]): CellValue => ({ k: "array", v });
export const cellOpaque = (v: string): CellValue => ({ k: "opaque", v });

// ── reading ─────────────────────────────────────────────────────────────────

export function isNull(cell: CellValue): boolean {
  return cell === null;
}

export function cellKind(cell: CellValue): CellKind | "null" {
  return cell === null ? "null" : cell.k;
}

/**
 * A short, lossless-where-possible string for the grid cell and for CSV export.
 *
 * NULL renders as the empty string here and the caller distinguishes it by
 * checking {@link isNull} — a display helper must never invent the text "NULL",
 * because a column can genuinely contain that string and the two would collide.
 */
export function displayText(cell: CellValue): string {
  if (cell === null) return "";
  switch (cell.k) {
    case "instant":
      return instantDisplay(cell.v);
    case "text":
    case "bigint":
    case "decimal":
    case "date":
    case "time":
    case "opaque":
      return cell.v;
    case "number":
      return String(cell.v);
    case "bool":
      return cell.v ? "true" : "false";
    case "bytes":
      // Byte counts, not the payload: a base64 blob in a 200px cell is noise.
      return `\\x… ${base64ByteLength(cell.v)} bytes`;
    case "json":
      return JSON.stringify(cell.v);
    case "array":
      return `{${cell.v.map(displayText).join(",")}}`;
  }
}

/** Decoded byte length of a base64 string, without decoding it. */
export function base64ByteLength(b64: string): number {
  const clean = b64.replace(/=+$/, "");
  return Math.floor((clean.length * 3) / 4);
}

/**
 * The string an editor should seed its input with, and that {@link parseCell}
 * round-trips. Unlike {@link displayText} this is lossless: `bytes` keeps its
 * base64 and `json` keeps its full serialization.
 */
/**
 * A timestamp as a person reads it: `2026-08-24 09:12:44+00`.
 *
 * The driver hands back RFC-3339 (`2026-08-24T09:12:44.845Z`), which is the
 * right thing to store and the wrong thing to put in a 150px column — the `T`,
 * the milliseconds and the `Z` are three pieces of punctuation you have to read
 * past to compare two rows. Postgres's own `\d` output is the model here.
 *
 * Rendered in UTC deliberately: the wire value IS an absolute instant, and
 * shifting it to the viewer's zone would make two people reading the same row
 * disagree about what it says. `editText` keeps the lossless original.
 */
function instantDisplay(iso: string): string {
  const parsed = Result.try({
    try: () => Temporal.Instant.from(iso).toZonedDateTimeISO("UTC"),
    catch: () => null,
  });
  // Unparseable is shown verbatim: a value we cannot read is still a value the
  // reader may recognise, and inventing a placeholder would hide it.
  if (parsed.isErr()) return iso;
  const z = parsed.value;
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${z.year}-${p2(z.month)}-${p2(z.day)} ${p2(z.hour)}:${p2(z.minute)}:${p2(z.second)}+00`;
}

export function editText(cell: CellValue): string {
  if (cell === null) return "";
  // The lossless original, so an untouched edit round-trips byte-for-byte.
  if (cell.k === "instant") return cell.v;
  if (cell.k === "json") return JSON.stringify(cell.v, null, 2);
  if (cell.k === "bytes") return cell.v;
  if (cell.k === "array") return JSON.stringify(cell.v.map(editText));
  return displayText(cell);
}

// ── writing ─────────────────────────────────────────────────────────────────

const INTEGER_LITERAL = /^-?\d+$/;
const DECIMAL_LITERAL = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

const BOOL_TRUE = new Set(["true", "t", "1", "yes", "y", "on"]);
const BOOL_FALSE = new Set(["false", "f", "0", "no", "n", "off"]);
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIME = /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/** One parser per kind. Returning `undefined` means "not valid for this kind". */
const CELL_PARSERS: Record<CellKind, (text: string) => CellValue | undefined> = {
  text: (text) => cellText(text),
  // `opaque` is a value we can transport but not interpret, so an edit of one
  // is passed through verbatim rather than being validated against a shape we
  // admit we do not know.
  opaque: (text) => cellText(text),
  number: (text) => {
    const t = text.trim();
    if (!DECIMAL_LITERAL.test(t)) return undefined;
    const n = Number(t);
    return Number.isFinite(n) ? cellNumber(n) : undefined;
  },
  bigint: (text) => (INTEGER_LITERAL.test(text.trim()) ? cellBigint(text.trim()) : undefined),
  decimal: (text) => (DECIMAL_LITERAL.test(text.trim()) ? cellDecimal(text.trim()) : undefined),
  bool: (text) => {
    const t = text.trim().toLowerCase();
    if (BOOL_TRUE.has(t)) return cellBool(true);
    if (BOOL_FALSE.has(t)) return cellBool(false);
    return undefined;
  },
  bytes: (text) => (BASE64.test(text.trim()) ? cellBytes(text.trim()) : undefined),
  json: (text) => {
    const parsed = jsonValueSchema.safeParse(safeJsonParse(text));
    return parsed.success ? cellJson(parsed.data) : undefined;
  },
  instant: (text) => (text.trim() === "" ? undefined : cellInstant(text.trim())),
  date: (text) => (ISO_DATE.test(text.trim()) ? cellDate(text.trim()) : undefined),
  time: (text) => (ISO_TIME.test(text.trim()) ? cellTime(text.trim()) : undefined),
  array: (text) => {
    const parsed = z.array(cellValueSchema).safeParse(safeJsonParse(text));
    return parsed.success ? cellArray(parsed.data) : undefined;
  },
};

/**
 * Turn editor text back into a cell of the column's declared kind.
 *
 * Returns `undefined` when the text isn't valid for that kind, so the caller
 * can keep the draft and show the error instead of writing a coerced value —
 * silently turning `"12x"` into `12` is how a grid edit corrupts a row.
 * `setNull` is a separate, explicit action; empty text is an empty string.
 */
export function parseCell(text: string, kind: CellKind): CellValue | undefined {
  return CELL_PARSERS[kind](text);
}

/**
 * `JSON.parse` behind a Result, so a malformed draft is an ordinary value the
 * caller inspects rather than a throw that has to be caught. Invalid text
 * becomes `undefined`, which every schema below then rejects.
 */
function safeJsonParse(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  const parsed = Result.try({
    // `JSON.parse` is typed `any`; widening to `unknown` at the boundary is what
    // forces the schema below to actually validate rather than wave it through.
    try: (): unknown => {
      const value: unknown = JSON.parse(trimmed);
      return value;
    },
    catch: () => undefined,
  });
  return parsed.isOk() ? parsed.value : undefined;
}

/**
 * The JS value a driver should bind for this cell.
 *
 * Exact numerics stay strings: every driver we use accepts a decimal string for
 * `numeric`/`int8` and converts server-side without going through a float.
 */
export function toDriverParam(cell: CellValue): string | number | boolean | null | Uint8Array {
  if (cell === null) return null;
  switch (cell.k) {
    // The wire value verbatim. `instantDisplay` is for READING; sending its
    // second-truncated form back would silently drop sub-second precision on
    // every row that round-trips through an edit.
    case "instant":
    case "text":
    case "bigint":
    case "decimal":
    case "date":
    case "time":
    case "opaque":
      return cell.v;
    case "number":
      return cell.v;
    case "bool":
      return cell.v;
    case "bytes":
      return decodeBase64(cell.v);
    case "json":
      return JSON.stringify(cell.v);
    case "array":
      return JSON.stringify(cell.v.map((c) => (c === null ? null : displayText(c))));
  }
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
