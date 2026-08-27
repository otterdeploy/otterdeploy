/**
 * CrowdSec alerts: the events behind one decision.
 *
 * A decision says "this IP is banned". The alert says WHY — which scenario
 * fired, how many events tripped it, and when. CrowdSec keeps the alert after
 * the decision expires, so this is the detail behind a history row.
 *
 * Read carefully, because `/v1/alerts` is the endpoint that has already burned
 * this install: unfiltered, it pins the LAPI at full CPU indefinitely once a
 * large imported-blocklist alert exists (v1.7.8). Two rules make it safe, and
 * both are load-bearing:
 *
 *   1. ALWAYS scoped to one `ip=` value. Never a list, never a bare fetch —
 *      it is only ever called for a row the operator clicked.
 *   2. `limit` capped and `include_capi=false`, so a community-blocklist alert
 *      carrying tens of thousands of sources can never be the response.
 *
 * There is no polling here on purpose. Nothing calls this on a timer; it is a
 * per-row lookup, which is what keeps the expensive endpoint bounded.
 */
import type { JsonObject } from "@otterdeploy/shared/json";

import { isJsonObject } from "@otterdeploy/shared/json";

import { lapiGetArray } from "./lapi-fetch";

export interface AlertEvent {
  /** CrowdSec's alert id. */
  id: number | null;
  scenario: string;
  /** Human sentence CrowdSec composes ("Ip 1.2.3.4 performed ssh-bf…"). */
  message: string;
  /** How many parsed log lines tripped the scenario. */
  eventsCount: number | null;
  /** Window the events fell in. */
  startedAt: string | null;
  stoppedAt: string | null;
  createdAt: string | null;
  /** Where the events were read from (`crowdsec`, `cscli`, a bouncer name). */
  origin: string;
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v !== "" ? v : typeof v === "number" ? String(v) : null;

function toAlert(alert: JsonObject): AlertEvent {
  const source = isJsonObject(alert.source) ? alert.source : {};
  return {
    id: typeof alert.id === "number" ? alert.id : null,
    scenario: str(alert.scenario) ?? "",
    message: str(alert.message) ?? "",
    eventsCount: typeof alert.events_count === "number" ? alert.events_count : null,
    startedAt: str(alert.start_at),
    stoppedAt: str(alert.stop_at),
    createdAt: str(alert.created_at),
    origin: str(source.scope) === "Ip" ? (str(alert.machine_id) ?? "crowdsec") : "crowdsec",
  };
}

/**
 * Alerts for ONE ip/CIDR, newest first. Null when the LAPI is unconfigured or
 * unreachable — the caller renders "detail unavailable" rather than an error,
 * since the history row itself is still perfectly good without it.
 */
export async function fetchAlertsForValue(value: string, limit = 20): Promise<AlertEvent[] | null> {
  const params = new URLSearchParams({
    ip: value,
    // Bounded on purpose (see the file header): a scoped, capped query is what
    // makes this endpoint usable at all.
    limit: String(Math.min(limit, 50)),
    // The community blocklist arrives as one alert with an enormous source
    // list. Excluding it is the difference between a fast response and the
    // CPU spin this endpoint is known for.
    include_capi: "false",
  });
  // 6s, not the decisions read's 10: this sits behind a disclosure, so a slow
  // answer should give up rather than leave a row looking stuck.
  const rows = await lapiGetArray(`/v1/alerts?${params.toString()}`, 6_000);
  if (!rows) return null;
  return rows.map(toAlert);
}
