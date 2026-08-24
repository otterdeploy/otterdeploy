/**
 * Telling "the control plane isn't there right now" apart from "the request was
 * wrong".
 *
 * Every control-plane restart — an update cutover above all, but also a plain
 * `docker restart` — puts the dashboard in front of a gap where the API is
 * gone and the reverse proxy is still up and answering. Every mounted query
 * that polls across that gap fails, and each failure used to raise its own red
 * toast reading `Error: MALFORMED_ORPC_ERROR_RESPONSE` — an oRPC internal
 * spelling of "someone answered but it wasn't your API", shown to an operator
 * as though they had done something wrong. The update dialog meanwhile promises
 * "this page will reconnect automatically", which is true; the toasts simply
 * narrated the reconnect as a pile of errors.
 *
 * `useCutoverRecovery` already reached this conclusion for its own health probe
 * and opted out with `meta.suppressErrorToast`. That's per-query, and the whole
 * rest of the app has no such flag. Classifying here covers every surface at
 * once, including restarts nobody started from the update dialog.
 */
import { ORPCError } from "@orpc/client";

/**
 * The lowest status we read as "an intermediary is telling us the origin is
 * gone". 502/503/504 are the classic three; the 52x family is Cloudflare's
 * (521 Web Server Is Down, 522 Connection Timed Out, 523, 524, 530).
 *
 * 500 and 501 deliberately sit BELOW the line: those are our own server
 * answering, and a real fault must keep its real toast.
 */
const GATEWAY_STATUS_FLOOR = 502;

/**
 * `fetch` rejects with a TypeError when no HTTP exchange happened at all —
 * connection refused, DNS gone, TLS handshake cut mid-restart. The message is
 * engine-specific ("Failed to fetch" on Chrome, "NetworkError when attempting
 * to fetch resource." on Firefox, "Load failed" on Safari), so match loosely
 * rather than pinning one browser's wording.
 */
const NETWORK_FAILURE = /failed to fetch|networkerror|load failed|network request failed/i;

/**
 * True when `error` means the control plane could not be reached, rather than
 * that it answered with a complaint.
 *
 * Deliberately keyed on STATUS, not on oRPC's error code. oRPC names only
 * nineteen statuses; anything outside that set collapses to the code
 * `MALFORMED_ORPC_ERROR_RESPONSE` regardless of what it was, so the code alone
 * would miss a 503 (which oRPC does name, as SERVICE_UNAVAILABLE) while
 * matching an unrelated 451. The status survives on the error either way.
 */
export function isControlPlaneUnreachable(error: unknown): boolean {
  if (error instanceof ORPCError) {
    if (error.status >= GATEWAY_STATUS_FLOOR) return true;
    // A named status below the floor was our server talking. An UNNAMED one
    // means the body didn't parse as an oRPC error either, so whatever
    // answered was not this API — an edge error page, a captive portal, a
    // half-configured proxy. "Unreachable" is the honest reading.
    return error.code === "MALFORMED_ORPC_ERROR_RESPONSE";
  }
  return error instanceof TypeError && NETWORK_FAILURE.test(error.message);
}
