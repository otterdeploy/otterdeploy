/**
 * A JSON log line, read as what it says rather than as the text it is.
 *
 * pino, bunyan, zap, Caddy's own logger and most Go services write one JSON
 * object per line. Shown raw, every row's MESSAGE column opened with
 * `{"level":"info","ts":1791434574.56,"logger":"http.log.access.log0",…` and
 * the actual message sat somewhere past the truncation. The level was already
 * read out of the object (see `log-severity`); this reads the message the same
 * way, and keeps everything else as fields the detail panel expands.
 *
 * Parsed once, at ingest. A line that is not a JSON object, or is one without
 * a message, is not structured and renders exactly as before.
 */

import { Result } from "better-result";
import * as z from "zod";

export interface StructuredLine {
  /** What the line says: the `msg` / `message` field. */
  message: string;
  /** Everything else on the object, in the order the line wrote it. */
  fields: Record<string, unknown>;
  /** Scalar fields as `key=value`, nested objects one level deep as
   *  `key.sub=value`, for the muted preview after the message. */
  preview: string;
}

/** The keys loggers put the message under, most common first. */
const MESSAGE_KEYS = ["msg", "message", "MESSAGE", "Message"] as const;

/** Already shown in their own columns (or meaningless once parsed out): the
 *  preview skips them so it spends its width on what is not on screen yet. */
const PREVIEW_SKIP = new Set(["level", "lvl", "severity", "ts", "time", "timestamp", "@timestamp"]);

const jsonObject = z.record(z.string(), z.unknown());

function scalarText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

/** `key=value` pairs, scalars first, then one level into nested objects.
 *  Arrays and deeper objects are left to the detail panel. */
function previewOf(fields: Record<string, unknown>): string {
  const top: string[] = [];
  const nested: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (PREVIEW_SKIP.has(key)) continue;
    const text = scalarText(value);
    if (text !== null) {
      top.push(`${key}=${text}`);
      continue;
    }
    if (Array.isArray(value)) continue;
    const inner = jsonObject.safeParse(value);
    if (!inner.success) continue;
    for (const [subKey, subValue] of Object.entries(inner.data)) {
      const subText = scalarText(subValue);
      if (subText !== null) nested.push(`${key}.${subKey}=${subText}`);
    }
  }
  return [...top, ...nested].join(" ");
}

export function parseStructuredLine(line: string): StructuredLine | null {
  const trimmed = line.trim();
  // Cheap gate before the parse: the tail runs this on every line it receives.
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  const parsed = Result.try({ try: (): unknown => JSON.parse(trimmed), catch: () => null });
  if (parsed.isErr()) return null;
  const object = jsonObject.safeParse(parsed.value);
  if (!object.success) return null;

  const messageKey = MESSAGE_KEYS.find((key) => {
    const value = object.data[key];
    return typeof value === "string" && value.trim() !== "";
  });
  if (messageKey === undefined) return null;

  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(object.data)) {
    if (key !== messageKey) fields[key] = value;
  }
  return { message: String(object.data[messageKey]), fields, preview: previewOf(fields) };
}
