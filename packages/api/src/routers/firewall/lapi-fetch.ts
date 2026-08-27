/**
 * One authenticated GET against CrowdSec's local API.
 *
 * Both LAPI readers (decisions, alerts) need the same four things: the
 * configured base URL, the bouncer key header, a timeout, and "null when we
 * couldn't read it" rather than a thrown error — because every caller treats
 * unreachable as a state to render, not a failure to propagate.
 *
 * The timeout is per call rather than fixed: the decisions read backs the
 * whole page and can afford to wait, while the alerts read sits behind a
 * disclosure and should give up before it makes a row feel stuck.
 */
import type { JsonObject } from "@otterdeploy/shared/json";

import { isJsonObject } from "@otterdeploy/shared/json";
import { Result } from "better-result";

import { crowdsecConfig } from "../../lib/platform-runtime-settings";

/**
 * GET `path` (a `/v1/…` path plus its query) and return the JSON array it
 * yields.
 *
 * `null` = could not read: unconfigured, unreachable, or a non-2xx. An empty
 * array = read fine, nothing matched. Callers depend on that distinction —
 * treating "unreachable" as "nothing is banned" would let the recorder close
 * every open decision the moment the agent restarts.
 */
export async function lapiGetArray(path: string, timeoutMs: number): Promise<JsonObject[] | null> {
  const crowdsec = await crowdsecConfig();
  if (!crowdsec) return null;

  const res = await Result.tryPromise({
    try: () =>
      fetch(`${crowdsec.apiUrl}${path}`, {
        headers: { "X-Api-Key": crowdsec.apiKey },
        signal: AbortSignal.timeout(timeoutMs),
      }),
    catch: (cause) => cause,
  });
  if (res.isErr() || !res.value.ok) return null;

  // These endpoints answer with a literal `null` body when nothing matches,
  // which is not an error and must not read as one.
  const body: unknown = await res.value.json().catch(() => null);
  return Array.isArray(body) ? body.filter(isJsonObject) : [];
}
