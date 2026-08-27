/**
 * Decisions read path for the Firewall view (split from index.ts under the
 * file cap). Primary source is the LAPI decisions endpoint. The same API the
 * bouncers poll, ~100ms with tens of thousands of active decisions. `cscli
 * decisions list` is only the fallback for reachable-but-unconfigured
 * installs: it goes through /v1/alerts, which spins the LAPI at full CPU
 * indefinitely once a large imported-blocklist alert exists (observed on
 * v1.7.8). Rows are enriched with country / AS from the local GeoIP DBs and
 * deduped per target.
 */
import type { JsonObject } from "@otterdeploy/shared/json";

import { isJsonObject } from "@otterdeploy/shared/json";

import { initGeo, lookupAsn, lookupCountry } from "../../edge-logs/geo";
import { crowdsecConfig } from "../../lib/platform-runtime-settings";
import { cscliRead, parseCscliJson } from "./cscli";
import { lapiGetArray } from "./lapi-fetch";

export interface Decision {
  id: number | null;
  origin: string;
  type: string;
  scope: string;
  value: string;
  duration: string;
  scenario: string;
  country: string | null;
  asNumber: string | null;
  asName: string | null;
  eventsCount: number | null;
  createdAt: string | null;
}

/** Enforcement is "configured" when bouncer credentials resolve AND the
 *  operator hasn't switched it off. That's exactly what wires the `crowdsec`
 *  gate into the generated Caddyfile. Independent of whether the control plane
 *  can currently read decisions, and of whether the agent container is up. */
export async function configured(): Promise<boolean> {
  return (await crowdsecConfig()) !== null;
}

/** Stringify a JSON field when it is a primitive; objects/arrays (which would
 *  render as `[object Object]`) yield null so the caller's fallback applies. */
const text = (v: unknown): string | null =>
  typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : null;

const str = (v: unknown): string | null => {
  const s = text(v);
  return s === "" ? null : s;
};

/** Flatten one CrowdSec decision (within its alert wrapper) into a row. */
function toDecision(d: JsonObject, alert: JsonObject, source: JsonObject): Decision {
  return {
    id: typeof d.id === "number" ? d.id : null,
    origin: text(d.origin) ?? text(alert.kind) ?? "crowdsec",
    type: text(d.type) ?? "ban",
    scope: text(d.scope) ?? text(source.scope) ?? "Ip",
    value: text(d.value) ?? text(source.value) ?? "",
    duration: text(d.duration) ?? "",
    scenario: text(d.scenario) ?? text(alert.scenario) ?? "",
    country: str(source.cn),
    asNumber: str(source.as_number),
    asName: str(source.as_name),
    eventsCount: typeof alert.events_count === "number" ? alert.events_count : null,
    createdAt: str(alert.created_at),
  };
}

/** Origins surfaced in the Decisions table: manual bans (`cscli`) and
 *  agent-triggered bans (`crowdsec`). Imported blocklists (`cscli-import`) are
 *  deliberately NOT fetched. They run to tens of thousands of decisions, so an
 *  unfiltered list was a multi-megabyte exec that froze the view; those IPs are
 *  managed as a whole in Sources. */
const DECISION_ORIGINS = ["cscli", "crowdsec"];

/** Primary read path. LAPI decisions endpoint. Returns null when
 *  unconfigured or unreachable (caller falls back to cscli). */
async function fetchDecisionsViaLapi(): Promise<Decision[] | null> {
  const rows = (
    await lapiGetArray(`/v1/decisions?origins=${DECISION_ORIGINS.join(",")}`, 10_000)
  )?.map((d) => toDecision(d, {}, {}));
  if (!rows) return null;
  // Newest first (decision ids are monotonic). A just-placed ban is on top.
  return rows.sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
}

/**
 * Fallback for reachable-but-unconfigured installs (no bouncer env on the
 * control plane): per-origin cscli reads, flattening CrowdSec's alert wrapper
 * so every active decision becomes one row enriched with its source
 * (country / ASN) + the alert's scenario + event count.
 */
async function fetchDecisionsViaCscli(): Promise<Decision[] | null> {
  // Sequential on purpose: every cscli invocation opens the agent's SQLite DB
  // with write intent (schema check), so concurrent cscli processes contend
  // for the lock and can starve the LAPI ("database is locked").
  const texts: (string | null)[] = [];
  for (const origin of DECISION_ORIGINS) {
    texts.push(await cscliRead(`cscli decisions list -o json --origin ${origin} --limit 500`));
  }
  if (texts.every((t) => t === null)) return null; // agent unreachable
  const rows: Decision[] = [];
  for (const text of texts) {
    for (const alert of parseCscliJson(text)) {
      const source = isJsonObject(alert.source) ? alert.source : {};
      const decisions = Array.isArray(alert.decisions) ? alert.decisions.filter(isJsonObject) : [];
      for (const d of decisions) {
        rows.push(toDecision(d, alert, source));
      }
    }
  }
  // Newest first so a just-placed manual ban is visibly at the top.
  return rows.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

/**
 * Fill country / AS from the local GeoIP DBs for rows CrowdSec didn't enrich
 * (manual bans never carry source enrichment; the LAPI decisions endpoint
 * carries none at all), and collapse duplicate decisions on the same target
 * (double-clicked bans) keeping the newest: rows arrive newest-first.
 */
async function enrichAndDedupe(rows: Decision[]): Promise<Decision[]> {
  await initGeo(); // idempotent: opens the readers once per process
  const seen = new Set<string>();
  const out: Decision[] = [];
  for (const row of rows) {
    const key = `${row.scope}:${row.value}:${row.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const scope = row.scope.toLowerCase();
    // Ranges enrich by their network address; Country/AS scopes aren't IPs.
    const ip = scope === "ip" ? row.value : scope === "range" ? row.value.split("/")[0] : null;
    if (ip) {
      row.country ??= lookupCountry(ip);
      if (row.asNumber == null && row.asName == null) {
        const asn = lookupAsn(ip);
        if (asn) {
          row.asNumber = String(asn.number);
          row.asName = asn.org;
        }
      }
    }
    out.push(row);
  }
  return out;
}

export async function fetchDecisions(): Promise<Decision[] | null> {
  const rows = (await fetchDecisionsViaLapi()) ?? (await fetchDecisionsViaCscli());
  return rows === null ? null : enrichAndDedupe(rows);
}
