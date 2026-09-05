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
import type { Obj } from "./normalize";

import { isObj } from "./normalize";

/**
 * Compose accepts labels as a map OR as a `KEY=value` list, and half the
 * ecosystem writes the list form (every Traefik example does). Reading only
 * one of them would make the same label work or not depending on how it was
 * spelled.
 */
export function normalizeLabels(v: unknown): Record<string, string> {
  if (isObj(v)) return fromMap(v);
  if (Array.isArray(v)) return fromList(v);
  return {};
}

function fromMap(v: Obj): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(v)) {
    // Compose stringifies scalars; `traefik.enable: false` is the common one.
    if (typeof value === "string") out[key] = value;
    else if (typeof value === "number" || typeof value === "boolean") out[key] = String(value);
  }
  return out;
}

function fromList(v: unknown[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of v) {
    if (typeof entry !== "string") continue;
    // Only the FIRST `=` separates, so a value may contain its own.
    const eq = entry.indexOf("=");
    // A bare key is a label with an empty value, which is what compose does.
    if (eq === -1) out[entry] = "";
    else out[entry.slice(0, eq)] = entry.slice(eq + 1);
  }
  return out;
}
