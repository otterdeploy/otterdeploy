/**
 * Firewall router — reads CrowdSec's active decisions (+ their alert context)
 * for the Firewall view. Org-scoped for access control, but the data is
 * cluster-wide (CrowdSec is identity-blind).
 *
 * The control plane talks to the agent by exec'ing `cscli … -o json` inside the
 * crowdsec container over the Docker socket it already manages — no LAPI
 * credentials or host networking needed. `cscli decisions list -o json` returns
 * the ALERT-wrapped shape, so each decision arrives with its source enrichment
 * (country / ASN / scenario / events) in one call. The bouncer key is still
 * only what Caddy uses to enforce; reads here don't need it.
 */

import type { BlocklistId } from "@otterdeploy/shared/id";

import { env } from "@otterdeploy/env/server";
import { Result } from "better-result";

import { orgScopedProcedure } from "../..";
import { flaggedIps } from "../../edge-logs/threat-scan";
import { listOrgDomains } from "../edge-logs/queries";
import { BLOCKLIST_CATALOG, catalogBySlug } from "./catalog";
import { cscliRead, cscliRun } from "./cscli";
import { blockIp, unblockIp } from "./decision";
import {
  deleteBlocklist,
  findBlocklistByCatalog,
  findBlocklistByUrl,
  getBlocklist,
  insertBlocklist,
  listBlocklists,
  setBlocklistEnabled,
  type BlocklistRow,
} from "./queries";
import { clearBlocklist, syncBlocklist } from "./sync";

interface Decision {
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
function configured(): boolean {
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

/**
 * Primary read path: the LAPI decisions endpoint (what bouncers use), which
 * answers in ~100ms even with tens of thousands of active decisions. `cscli
 * decisions list` goes through /v1/alerts, which spins the LAPI at full CPU
 * indefinitely once a large imported-blocklist alert exists (observed on
 * v1.7.8) — never route reads through it when the LAPI is configured.
 * Returns null when unconfigured/unreachable (caller falls back to cscli).
 */
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

async function fetchDecisions(): Promise<Decision[] | null> {
  return (await fetchDecisionsViaLapi()) ?? fetchDecisionsViaCscli();
}

export const firewallRouter = {
  status: orgScopedProcedure.firewall.status.handler(async () => {
    // Reachable = the agent answered `cscli lapi status` over the Docker exec.
    const lapi = await cscliRead("cscli lapi status");
    return {
      configured: configured(),
      reachable: lapi !== null,
    };
  }),

  decisions: orgScopedProcedure.firewall.decisions.handler(async () => {
    return (await fetchDecisions()) ?? [];
  }),

  block: orgScopedProcedure.firewall.block.handler(async ({ input, context }) => {
    context.log.set({ target: { type: "ip", id: input.ip } });
    const reason = input.reason?.trim() || `manual:${context.session?.user?.id ?? "operator"}`;
    const res = await blockIp(input.ip, input.durationHours, reason);
    return { ok: res.ok, error: res.error ?? null };
  }),

  unblock: orgScopedProcedure.firewall.unblock.handler(async ({ input, context }) => {
    context.log.set({ target: { type: "ip", id: input.ip } });
    const res = await unblockIp(input.ip);
    return { ok: res.ok, error: res.error ?? null };
  }),

  flagged: orgScopedProcedure.firewall.flagged.handler(async ({ input, context }) => {
    const hosts = await listOrgDomains(context.activeOrganizationId);
    const sinceMs = Date.now() - input.windowMinutes * 60_000;
    return flaggedIps(hosts, sinceMs, 100);
  }),

  blocklists: {
    list: orgScopedProcedure.firewall.blocklists.list.handler(async () => {
      const rows = await listBlocklists();
      return {
        lists: rows.map(toBlocklistView),
        catalog: BLOCKLIST_CATALOG.map((c) => ({
          slug: c.slug,
          name: c.name,
          description: c.description,
          url: c.url,
          durationHours: c.durationHours,
          intervalMinutes: c.intervalMinutes,
          added: rows.some((r) => r.catalogSlug === c.slug),
        })),
      };
    }),

    addCustom: orgScopedProcedure.firewall.blocklists.addCustom.handler(
      async ({ input, errors }) => {
        if (!/^https?:\/\//i.test(input.url)) {
          throw errors.INVALID_INPUT({ message: "URL must be http(s)." });
        }
        if (await findBlocklistByUrl(input.url)) throw errors.CONFLICT();
        const row = await insertBlocklist({
          name: input.name.trim(),
          url: input.url.trim(),
          durationHours: input.durationHours,
          intervalMinutes: input.intervalMinutes,
        });
        // Pull it now in the background; the list view polls for the result.
        void syncBlocklist(row);
        return toBlocklistView(row);
      },
    ),

    enableCatalog: orgScopedProcedure.firewall.blocklists.enableCatalog.handler(
      async ({ input, errors }) => {
        const entry = catalogBySlug(input.slug);
        if (!entry) throw errors.INVALID_INPUT({ message: "Unknown list." });
        if (await findBlocklistByCatalog(entry.slug)) throw errors.CONFLICT();
        const row = await insertBlocklist({
          name: entry.name,
          url: entry.url,
          catalogSlug: entry.slug,
          durationHours: entry.durationHours,
          intervalMinutes: entry.intervalMinutes,
        });
        void syncBlocklist(row);
        return toBlocklistView(row);
      },
    ),

    toggle: orgScopedProcedure.firewall.blocklists.toggle.handler(async ({ input, errors }) => {
      const id = input.id as BlocklistId;
      const existing = await getBlocklist(id);
      if (!existing) throw errors.NOT_FOUND();
      const row = await setBlocklistEnabled(id, input.enabled);
      if (!row) throw errors.NOT_FOUND();
      if (input.enabled) void syncBlocklist(row);
      else void clearBlocklist(row);
      return toBlocklistView(row);
    }),

    remove: orgScopedProcedure.firewall.blocklists.remove.handler(async ({ input, errors }) => {
      const id = input.id as BlocklistId;
      const row = await getBlocklist(id);
      if (!row) throw errors.NOT_FOUND();
      await clearBlocklist(row);
      await deleteBlocklist(id);
      return { ok: true };
    }),

    syncNow: orgScopedProcedure.firewall.blocklists.syncNow.handler(async ({ input, errors }) => {
      const id = input.id as BlocklistId;
      const row = await getBlocklist(id);
      if (!row) throw errors.NOT_FOUND();
      const result = await syncBlocklist(row);
      return { ok: result.ok, count: result.count, error: result.error ?? null };
    }),
  },

  console: {
    status: orgScopedProcedure.firewall.console.status.handler(async () => {
      return { available: (await cscliRead("cscli lapi status")) !== null };
    }),

    enroll: orgScopedProcedure.firewall.console.enroll.handler(async ({ input, errors }) => {
      // Key passed as a positional arg ($1) — never interpolated into the shell.
      const out = await cscliRun('cscli console enroll "$1"', [input.key.trim()]);
      if (out === null) {
        throw errors.INVALID_INPUT({
          message: "CrowdSec agent isn't running.",
        });
      }
      const ok = !/error|invalid|failed|denied/i.test(out);
      const message =
        out.trim().split("\n").filter(Boolean).slice(-2).join(" ").slice(0, 300) ||
        (ok ? "Enrollment requested — accept the instance in the console." : "Enrollment failed.");
      return { ok, message };
    }),
  },
};

function toBlocklistView(r: BlocklistRow) {
  return {
    id: r.id,
    name: r.name,
    url: r.url,
    catalogSlug: r.catalogSlug,
    enabled: r.enabled,
    durationHours: r.durationHours,
    intervalMinutes: r.intervalMinutes,
    lastSyncedAt: r.lastSyncedAt ? r.lastSyncedAt.toISOString() : null,
    lastStatus: r.lastStatus,
    lastError: r.lastError,
    lastCount: r.lastCount,
  };
}
