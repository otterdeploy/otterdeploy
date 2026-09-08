/**
 * Compose `labels`, normalized to a flat map.
 *
 * Its own module rather than another function in normalize.ts, which is at the
 * file-length cap.
 *
 * The platform reads a small set of `otterdeploy.*` keys off this map for
 * facts compose has no field for — today `otterdeploy.upstream.protocol`,
 * which says the service speaks gRPC and must be dialled over h2c. Everything
 * else passes through untouched: a stack's own labels (Traefik's, say) are
 * none of our business.
 */
// Straight from the shared JSON primitives, NOT via ./normalize, which merely
// aliases them (`Obj = JsonObject`, `isObj = isJsonObject`). Importing the
// aliases would make labels.ts <-> normalize.ts a cycle, since normalize.ts
// imports `normalizeLabels` from here — and this module needs the primitives,
// not anything normalize.ts actually owns.
import type { JsonObject } from "@otterdeploy/shared/json";

import { isJsonObject } from "@otterdeploy/shared/json";

import { parseKeyValueList } from "./kv-list";

/**
 * Compose accepts labels as a map OR as a `KEY=value` list, and half the
 * ecosystem writes the list form (every Traefik example does). Reading only
 * one of them would make the same label work or not depending on how it was
 * spelled.
 */
export function normalizeLabels(v: unknown): Record<string, string> {
  if (isJsonObject(v)) return fromMap(v);
  if (Array.isArray(v)) return parseKeyValueList(v);
  return {};
}

function fromMap(v: JsonObject): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(v)) {
    // Compose stringifies scalars; `traefik.enable: false` is the common one.
    if (typeof value === "string") out[key] = value;
    else if (typeof value === "number" || typeof value === "boolean") out[key] = String(value);
  }
  return out;
}
