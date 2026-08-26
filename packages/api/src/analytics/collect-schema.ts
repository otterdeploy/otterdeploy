/**
 * Wire format of `POST /a/c` (docs/designs/web-analytics.md §3). The tracker
 * is a public, untrusted client: every field is bounded here so nothing
 * unbounded ever reaches the sessionizer or a jsonb column.
 */

import type { JsonObject } from "@otterdeploy/shared/json";

import { Result, TaggedError } from "better-result";
import * as z from "zod";

export const PUBLIC_KEY_RE = /^od_[0-9a-f]{32}$/;
export const EVENT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _.:-]*$/;
export const MAX_EVENTS_PER_BATCH = 50;
export const MAX_BODY_BYTES = 64 * 1024;

const clientId = z.string().min(1).max(64);
const pageUrl = z.string().min(1).max(2048);
const epochMs = z.number().int().nonnegative();

const base = { id: clientId, ts: epochMs };

const pageview = z.object({
  ...base,
  t: z.literal("pv"),
  u: pageUrl,
  r: z.string().max(2048).optional(),
  ti: z.string().max(200).optional(),
  sw: z.number().int().min(0).max(10_000).optional(),
  l: z.string().max(16).optional(),
});

const customEvent = z.object({
  ...base,
  t: z.literal("ev"),
  u: pageUrl,
  n: z.string().min(1).max(64).regex(EVENT_NAME_RE),
  p: z.record(z.string(), z.unknown()).optional(),
});

const engagement = z.object({
  ...base,
  t: z.literal("eng"),
  u: pageUrl,
  a: z.number().int().nonnegative(),
  vis: z.number().int().nonnegative().optional(),
  sc: z.number().int().min(0).max(100).optional(),
});

const heartbeat = z.object({ ...base, t: z.literal("hb"), u: pageUrl });

const identify = z.object({ ...base, t: z.literal("id"), uid: z.string().min(1).max(128) });

export const collectEventSchema = z.discriminatedUnion("t", [
  pageview,
  customEvent,
  engagement,
  heartbeat,
  identify,
]);

export const collectBatchSchema = z.object({
  k: z.string().regex(PUBLIC_KEY_RE),
  v: z.literal(1),
  sid: z.string().min(1).max(64),
  e: z.array(collectEventSchema).max(MAX_EVENTS_PER_BATCH),
});

export type CollectBatch = z.infer<typeof collectBatchSchema>;
export type CollectEvent = z.infer<typeof collectEventSchema>;
export type CollectPageview = z.infer<typeof pageview>;
export type CollectCustomEvent = z.infer<typeof customEvent>;

export class CollectParseError extends TaggedError("CollectParseError")<{
  message: string;
}>() {}

/** JSON boundary: parsed with zod, never cast. Malformed JSON and schema
 *  violations both collapse into one error, the caller answers 400 either way. */
export function parseCollectBody(text: string): Result<CollectBatch, CollectParseError> {
  return Result.try({
    try: (): CollectBatch => collectBatchSchema.parse(JSON.parse(text)),
    catch: (cause) =>
      new CollectParseError({ message: cause instanceof Error ? cause.message : String(cause) }),
  });
}

/** Prop keys that look like credentials or PII are dropped at collect
 *  (design §8), regardless of what the page put in them. */
export const SECRET_KEY_RE =
  /token|secret|password|passwd|authorization|api[-_]?key|email|ssn|card/i;

export const MAX_PROP_KEYS = 32;
export const MAX_PROP_KEY_LENGTH = 40;
export const MAX_PROP_STRING_LENGTH = 256;

/**
 * Reduce a custom event's props to a small, flat, jsonb-safe object: at most
 * 32 keys, keys ≤ 40 chars, values a string (≤ 256 chars), finite number or
 * boolean. Nested objects, arrays, nulls and secret-shaped keys are dropped.
 * Returns null when nothing survives, so the column stays NULL rather than `{}`.
 */
export function sanitizeProps(p: unknown): JsonObject | null {
  if (typeof p !== "object" || p === null || Array.isArray(p)) return null;
  const out: JsonObject = {};
  let kept = 0;
  for (const [rawKey, value] of Object.entries(p)) {
    if (kept >= MAX_PROP_KEYS) break;
    const key = rawKey.trim();
    if (!key || key.length > MAX_PROP_KEY_LENGTH || SECRET_KEY_RE.test(key)) continue;
    if (typeof value === "string") {
      out[key] =
        value.length > MAX_PROP_STRING_LENGTH ? value.slice(0, MAX_PROP_STRING_LENGTH) : value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
    } else if (typeof value === "boolean") {
      out[key] = value;
    } else {
      continue;
    }
    kept++;
  }
  return kept === 0 ? null : out;
}
