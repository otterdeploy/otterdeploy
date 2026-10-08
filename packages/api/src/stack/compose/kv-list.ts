/**
 * Compose's `KEY=value` list form, parsed once.
 *
 * Several compose fields accept either a map or a list of `KEY=value` strings,
 * and half the ecosystem writes each. `environment` and `labels` both do, and
 * both had their own copy of this loop — identical down to the comment about
 * the first `=`. Two copies of a parser is two places for it to disagree about
 * an edge case, and the edge cases here are the whole job: a value containing
 * its own `=`, and a bare key.
 *
 * A LEAF on purpose: it imports nothing from this directory. `normalize.ts`
 * already imports `labels.ts`, so putting the shared helper in either of them
 * would either add an edge or restore the cycle that labels.ts was just
 * untangled from.
 */

import { isJsonObject, type JsonObject } from "@otterdeploy/shared/json";

/** One list entry as `[key, value]`, or `[key, null]` for a bare key. Only the
 *  FIRST `=` separates, so a value may contain its own. */
function splitEntry(entry: string): [string, string | null] {
  const eq = entry.indexOf("=");
  return eq === -1 ? [entry, null] : [entry.slice(0, eq), entry.slice(eq + 1)];
}

/**
 * `["A=1", "B"]` → `{ A: "1", B: "" }`.
 *
 * A bare key is an empty value, which is what compose does for `labels`.
 * Non-string entries are skipped rather than coerced: a list that contains a
 * map is author error, and inventing a key for it would hide that.
 */
export function parseKeyValueList(entries: readonly unknown[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of entries) {
    if (typeof entry !== "string") continue;
    const [key, value] = splitEntry(entry);
    out[key] = value ?? "";
  }
  return out;
}

/** A service's `environment`, split by what each entry asks for. */
export interface ParsedEnvironment {
  /** `KEY=value` entries. */
  values: Record<string, string>;
  /** Bare `KEY` entries: take the same-named variable's value, else unset. */
  passthrough: string[];
}

/**
 * `["A=1", "B"]` → `{ values: { A: "1" }, passthrough: ["B"] }`.
 *
 * In `environment` a bare key is NOT an empty value. Compose reads it as "pass
 * `B` through from the environment compose runs in, and leave it unset when
 * that has none", which is how upstream files list optional settings:
 * Plausible CE names thirty of them (`HTTP_PORT`, `DATABASE_URL`, ...) and
 * n8n's Postgres takes `POSTGRES_PASSWORD` this way. Reading them as `""` set
 * every one to an empty string, which is not "unset": Plausible bound to port
 * "" and n8n's Postgres refused to initialise without a password. A later
 * entry for the same key wins, as in compose.
 */
function parseEnvironmentList(entries: readonly unknown[]): ParsedEnvironment {
  const values = new Map<string, string>();
  const passthrough = new Set<string>();
  for (const entry of entries) {
    if (typeof entry !== "string") continue;
    const [key, value] = splitEntry(entry);
    if (value === null) {
      values.delete(key);
      passthrough.add(key);
    } else {
      passthrough.delete(key);
      values.set(key, value);
    }
  }
  return { values: Object.fromEntries(values), passthrough: [...passthrough] };
}

/**
 * A service's `environment`, in either spelling. A bare list entry
 * (`- HTTP_PORT`) and a map key with no value (`HTTP_PORT:`) both pass through
 * (see `parseEnvironmentList`); map values are coerced to strings, a nested
 * map/list kept visible as JSON rather than an opaque "[object Object]".
 */
export function parseEnvironment(v: unknown): ParsedEnvironment {
  if (Array.isArray(v)) return parseEnvironmentList(v);
  if (!isJsonObject(v)) return { values: {}, passthrough: [] };
  return parseEnvironmentMap(v);
}

function parseEnvironmentMap(v: JsonObject): ParsedEnvironment {
  const values: Record<string, string> = {};
  const passthrough: string[] = [];
  for (const [key, value] of Object.entries(v)) {
    if (value == null) passthrough.push(key);
    else values[key] = typeof value === "object" ? JSON.stringify(value) : String(value);
  }
  return { values, passthrough };
}
