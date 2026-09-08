/**
 * Structured log lines, read as logs rather than as text.
 *
 * Most things running in a container log JSON — pino, bunyan, zap, logrus,
 * slog, Temporal, Postgres exporters. Printed raw, one row reads:
 *
 *   {"level":"warn","ts":"2026-09-08T21:30:34.425Z","msg":"sql handle: did no…
 *
 * which is a wall of quoting in which the only part anyone wants — the message
 * — is a third of the way in and truncated off the end. Every row starts with
 * the same eleven characters, so the column that should be scannable is a
 * texture. The level is in there too, so the viewer's severity colour was
 * guessed from a heuristic over the JSON text while the line was carrying the
 * answer.
 *
 * So: parse it once at ingest and keep the three things a log row is made of —
 * when, how bad, what happened — plus the remaining fields, which are the
 * context that makes a message actionable and belong beside it rather than
 * inside the sentence.
 *
 * Deliberately narrow:
 *
 * - **Only a JSON object with a message field counts.** A line that parses as
 *   `[1,2,3]`, or an object with no message, is not a log entry someone wrote
 *   for a human; it is data, and it stays verbatim.
 * - **Nothing is invented.** A missing level stays absent so the caller's own
 *   inference runs, rather than everything defaulting to "info" and a stack
 *   trace rendering calm.
 */

import { Result } from "better-result";

/** Where the message lives, in the order the ecosystems are worth checking. */
const MESSAGE_KEYS = ["msg", "message", "MESSAGE", "log", "event"] as const;
/** Where the level lives. */
const LEVEL_KEYS = ["level", "severity", "lvl", "levelname", "log.level"] as const;
/** Where the timestamp lives. */
const TIME_KEYS = ["ts", "time", "timestamp", "@timestamp", "eventTime"] as const;

/**
 * Fields that are noise in every row: the ones we lifted out, plus the
 * identifiers a log pipeline stamps on everything it carries.
 */
const DROPPED_FIELDS = new Set<string>([
  ...MESSAGE_KEYS,
  ...LEVEL_KEYS,
  ...TIME_KEYS,
  "v",
  "pid",
  "hostname",
]);

/** Pino/bunyan numeric levels. */
const NUMERIC_LEVELS: ReadonlyArray<readonly [number, StructuredLevel]> = [
  [60, "fatal"],
  [50, "error"],
  [40, "warn"],
  [30, "info"],
  [20, "debug"],
  [10, "trace"],
];

export type StructuredLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

const LEVEL_WORDS: Record<string, StructuredLevel> = {
  fatal: "fatal",
  critical: "fatal",
  crit: "fatal",
  panic: "fatal",
  emerg: "fatal",
  alert: "fatal",
  error: "error",
  err: "error",
  eror: "error",
  warn: "warn",
  warning: "warn",
  notice: "info",
  info: "info",
  information: "info",
  debug: "debug",
  dbug: "debug",
  trace: "trace",
  verbose: "trace",
};

export interface StructuredLine {
  /** The human sentence, with the machinery around it removed. */
  message: string;
  /** The level the line declared, or `null` when it declared none. */
  level: StructuredLevel | null;
  /** Epoch ms from the line's own timestamp, when it carried a readable one. */
  tsMs: number | null;
  /** Everything else, in the order the emitter wrote it. */
  fields: ReadonlyArray<readonly [string, unknown]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function levelOf(value: unknown): StructuredLevel | null {
  if (typeof value === "number") {
    // Pino emits the numeric floor of a range: 35 is still info, 55 still error.
    for (const [floor, level] of NUMERIC_LEVELS) if (value >= floor) return level;
    return null;
  }
  if (typeof value !== "string") return null;
  return LEVEL_WORDS[value.trim().toLowerCase()] ?? null;
}

function timeOf(value: unknown): number | null {
  // Epoch millis (pino's default) or seconds; anything else goes through the
  // string parser, which covers ISO-8601 and RFC 2822.
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e11 ? value : value * 1000;
  }
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function firstOf(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (Object.hasOwn(record, key)) return record[key];
  }
  return undefined;
}

/**
 * A raw line → its structured reading, or `null` when it is not one.
 *
 * `null` is the common case and has to be cheap: a build log is thousands of
 * plain lines a second, so anything that cannot be an object is rejected on the
 * first character rather than by a failed parse.
 */
export function parseStructuredLine(line: string): StructuredLine | null {
  const trimmed = line.trim();
  if (trimmed.length < 2 || trimmed[0] !== "{" || !trimmed.endsWith("}")) return null;

  const parsed = Result.try({
    try: (): unknown => JSON.parse(trimmed),
    catch: () => null,
  }).unwrapOr(null);
  if (!isRecord(parsed)) return null;

  const message = firstOf(parsed, MESSAGE_KEYS);
  // No message is no log entry: JSON output that happens to flow through a log
  // stream (a config dump, an API response) stays exactly as it was written.
  if (typeof message !== "string") return null;

  const fields = Object.entries(parsed).filter(
    ([key, value]) => !DROPPED_FIELDS.has(key) && value !== undefined,
  );

  return {
    message,
    level: levelOf(firstOf(parsed, LEVEL_KEYS)),
    tsMs: timeOf(firstOf(parsed, TIME_KEYS)),
    fields,
  };
}

/** One field's value, short enough to sit at the end of a row. */
export function fieldText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  // An object or array beside the message is a shape, not a value: the detail
  // panel shows it properly, so the row says only that it is there.
  return Array.isArray(value) ? `[${value.length}]` : "{…}";
}
