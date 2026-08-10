// Fallback for the few procedures that do not declare an HTTP method.
//
// The single source of truth for "is this a read?" across the API. Two
// independent gates depend on it agreeing with itself: the audit read-gate
// (../index.ts) and the read-only API-key preset (isReadAllowed in
// ./api-key-scope.ts). Both import from here — do not copy this regex.
import type { UnknownRecord } from "@otterdeploy/shared/json";

const READ_VERB =
  /^(list|get|inspect|stream|search|count|fetch|read|resolve|view|preview|status|events|logs|metrics|stats)/i;

/** True when the oRPC procedure path (e.g. `service.deploy`) is a read action. */
export function isReadAction(action: string): boolean {
  return READ_VERB.test(action.split(".").pop() ?? action);
}

/**
 * Prefer contract HTTP metadata over name heuristics. Contracts may declare
 * the method in either oRPC's route field or the repository's meta field.
 *
 * `meta` is oRPC's open `Meta` bag (`Record<string, any>` upstream): contracts
 * stash arbitrary runtime values there (`tag`, `method`, …), so `UnknownRecord`
 * is the honest view — only `method` is read, and it is runtime-checked.
 */
export function isReadMethod(
  meta: UnknownRecord | undefined,
  route: { method?: string } | undefined,
): boolean | null {
  const method = route?.method ?? meta?.method;
  return typeof method === "string" ? method.toUpperCase() === "GET" : null;
}
