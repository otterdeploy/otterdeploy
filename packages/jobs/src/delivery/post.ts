/**
 * The one guarded POST every transport goes through.
 *
 * `channel.target` is tenant-supplied for slack/discord/webhook — a URL the org
 * pasted in — so every request routes through the shared egress policy: resolve
 * and validate the address (loopback, private, link-local, metadata ranges and
 * the control plane's own identity denied by default), pin the connection to
 * the validated address, and re-validate every redirect hop. Fixed-URL
 * transports (FCM, PagerDuty) use it too, for consistency.
 *
 * It never throws: a provider error becomes a {@link DeliveryResult}, so one
 * dead or blocked channel cannot fail the whole fan-out.
 */

import { EgressPolicyError, egressFetch } from "@otterdeploy/shared/egress-policy";

import type { DeliveryResult } from "./types";

import { controlPlaneEgressDenylist, egressAllowlist } from "./egress-denylist";

const CHANNEL_DELIVERY_TIMEOUT_MS = 10_000;
const CHANNEL_MAX_RESPONSE_BYTES = 1024 * 1024;

/** Guarded POST. Resolves+validates the destination via the shared egress
 *  policy, pins the connection, and turns a thrown/network/policy error
 *  into a {@link DeliveryResult} rather than a throw (so one dead/blocked
 *  channel can't fail the whole fan-out). */
export async function post(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<DeliveryResult> {
  let statusCode: number;
  let text: () => Promise<string>;
  try {
    const denylist = await controlPlaneEgressDenylist();
    const res = await egressFetch(
      url,
      { method: "POST", headers: init.headers, body: init.body },
      {
        // Channel receivers (self-hosted webhook sinks, internal relays)
        // are commonly plain http. The address checks are the actual SSRF
        // defense, not the scheme.
        allowHttp: true,
        timeoutMs: CHANNEL_DELIVERY_TIMEOUT_MS,
        maxBytes: CHANNEL_MAX_RESPONSE_BYTES,
        maxRedirects: 5,
        denyHosts: denylist.blockedHosts,
        denyAddresses: denylist.blockedAddresses,
        allowAddresses: await egressAllowlist(),
      },
    );
    if (res.ok) return { ok: true };
    statusCode = res.status;
    text = () => res.text();
  } catch (err) {
    if (err instanceof EgressPolicyError) {
      return { ok: false, error: `blocked by outbound egress policy: ${err.message}` };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const body = await text().catch(() => "");
  return { ok: false, error: `HTTP ${statusCode}${body ? `: ${body.slice(0, 200)}` : ""}` };
}
