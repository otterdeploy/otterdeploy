/**
 * Decisions read path for the Firewall view (split from index.ts under the
 * file cap). Primary source is the LAPI decisions endpoint — the same API the
 * bouncers poll, ~100ms with tens of thousands of active decisions. `cscli
 * decisions list` is only the fallback for reachable-but-unconfigured
 * installs: it goes through /v1/alerts, which spins the LAPI at full CPU
 * indefinitely once a large imported-blocklist alert exists (observed on
 * v1.7.8). Rows are enriched with country / AS from the local GeoIP DBs and
 * deduped per target.
 */
import { env } from "@otterdeploy/env/server";
import { Result } from "better-result";

import { initGeo, lookupAsn, lookupCountry } from "../../edge-logs/geo";
import { cscliRead } from "./cscli";

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

/** Enforcement is "configured" when the bouncer env is set — that's what wires
 *  the `crowdsec` gate into the generated Caddyfile. Independent of whether the
 *  control plane can currently read decisions. */
export function configured(): boolean {
  return Boolean(env.CROWDSEC_LAPI_URL && env.CROWDSEC_BOUNCER_KEY);
}

/** Parse `cscli … -o json` output. Empty result is printed as `null`. */
function parseJsonArray(text: string | null): Record<string, unknown>[] {
  if (!text) return [];
  const trimmed = text.trim();
  if (!trimmed || trimmed === "null") return [];
  const parsed = Result.try({
    try: () => JSON.parse(trimmed) as unknown,
    catch: () => null,
  });
  if (parsed.isErr() || !Array.isArray(parsed.value)) return [];
  return parsed.value as Record<string, unknown>[];
}

const str = (v: unknown): string | null =>
  v === undefined || v === null || v === "" ? null : String(v);

/** Flatten one CrowdSec decision (within its alert wrapper) into a row. */
function toDecision(
  d: Record<string, unknown>,
  alert: Record<string, unknown>,
  source: Record<string, unknown>,
): Decision {
  return {
    id: typeof d.id === "number" ? d.id : null,
    origin: String(d.origin ?? alert.kind ?? "crowdsec"),
    type: String(d.type ?? "ban"),
    scope: String(d.scope ?? source.scope ?? "Ip"),
    value: String(d.value ?? source.value ?? ""),
    duration: String(d.duration ?? ""),
    scenario: String(d.scenario ?? alert.scenario ?? ""),
    country: str(source.cn),
    asNumber: str(source.as_number),
    asName: str(source.as_name),
    eventsCount: typeof alert.events_count === "number" ? alert.events_count : null,
    createdAt: str(alert.created_at),
  };
}

/** Origins surfaced in the Decisions table: manual bans (`cscli`) and
 *  agent-triggered bans (`crowdsec`). Imported blocklists (`cscli-import`) are
 *  deliberately NOT fetched — they run to tens of thousands of decisions, so an
 *  unfiltered list was a multi-megabyte exec that froze the view; those IPs are
 *  managed as a whole in Sources. */
const DECISION_ORIGINS = ["cscli", "crowdsec"];

/** Primary read path — LAPI decisions endpoint. Returns null when
 *  unconfigured or unreachable (caller falls back to cscli). */
async function fetchDecisionsViaLapi(): Promise<Decision[] | null> {
  if (!configured()) return null;
  const url = `${env.CROWDSEC_LAPI_URL}/v1/decisions?origins=${DECISION_ORIGINS.join(",")}`;
  const res = await Result.tryPromise({
    try: () =>
      fetch(url, {
        headers: { "X-Api-Key": env.CROWDSEC_BOUNCER_KEY as string },
        signal: AbortSignal.timeout(10_000),
      }),
    catch: (cause) => cause,
  });
  if (res.isErr() || !res.value.ok) return null;
  // The endpoint returns a literal `null` body when nothing matches.
  const body = (await res.value.json().catch(() => null)) as Record<string, unknown>[] | null;
  const rows = (Array.isArray(body) ? body : []).map((d) => toDecision(d, {}, {}));
  // Newest first (decision ids are monotonic) — a just-placed ban is on top.
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
    for (const alert of parseJsonArray(text)) {
      const source = (alert.source as Record<string, unknown> | undefined) ?? {};
      const decisions = Array.isArray(alert.decisions)
        ? (alert.decisions as Record<string, unknown>[])
        : [];
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
 * (double-clicked bans) keeping the newest — rows arrive newest-first.
 */
async function enrichAndDedupe(rows: Decision[]): Promise<Decision[]> {
  await initGeo(); // idempotent — opens the readers once per process
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
