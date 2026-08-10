/**
 * The honest types for JSON-shaped data: values that round-trip through
 * `JSON.stringify` / Postgres `jsonb` / a parsed HTTP body. Use these instead
 * of `Record<string, unknown>` — a `JsonObject` tells the reader (and the
 * compiler) that the values are themselves traversable JSON, not arbitrary
 * runtime values like functions, class instances, or promises.
 *
 * Index-signature values admit `undefined` so that zod-inferred types with
 * optional fields assign directly — `JSON.stringify` drops `undefined`
 * entries, so the wire/storage semantics are unchanged. Data read back from
 * a JSON source never actually contains `undefined`.
 *
 * Prefer, in order:
 *   1. A concrete domain type (zod-inferred, or a purpose-built interface).
 *   2. `JsonObject` / `JsonValue`, for genuinely free-form JSON.
 *   3. `UnknownRecord`, only when a value is a string-keyed bag whose values
 *      may be non-JSON runtime objects (e.g. third-party library constraints).
 */

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;

export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

/**
 * Narrow parsed-JSON data to an object for traversal. Only sound when
 * `value` originates from a JSON source (parsed body, jsonb column, YAML
 * scalar tree) — a Date or class instance would also pass this check, so
 * don't use it on arbitrary runtime values.
 */
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Last resort for string-keyed bags of genuinely unknown runtime values —
 * the rare site where a library constraint or heterogeneous mutation pattern
 * makes both a concrete type and `JsonObject` impossible. If you are about
 * to reach for this for parsed JSON, use `JsonObject` instead.
 */
export interface UnknownRecord { [key: string]: unknown }
