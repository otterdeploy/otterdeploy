// Fallback for the few procedures that do not declare an HTTP method.
const READ_VERB =
  /^(list|get|inspect|stream|search|count|fetch|read|resolve|view|preview|status|events|logs|metrics|stats)/i;

export function isReadAction(action: string): boolean {
  return READ_VERB.test(action.split(".").pop() ?? action);
}

/**
 * Prefer contract HTTP metadata over name heuristics. Contracts may declare
 * the method in either oRPC's route field or the repository's meta field.
 */
export function isReadMethod(
  meta: Record<string, unknown> | undefined,
  route: { method?: string } | undefined,
): boolean | null {
  const method = route?.method ?? meta?.method;
  return typeof method === "string" ? method.toUpperCase() === "GET" : null;
}
