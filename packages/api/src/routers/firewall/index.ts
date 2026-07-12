/**
 * Firewall router — CrowdSec decisions (read via LAPI, see decisions-read.ts),
 * block/unblock actions, flagged-IP review, and managed blocklists. Org-scoped
 * for access control, but the data is cluster-wide (CrowdSec is
 * identity-blind).
 */

import type { BlocklistId } from "@otterdeploy/shared/id";

import { orgScopedProcedure } from "../..";
import { flaggedIps } from "../../edge-logs/threat-scan";
import { listOrgDomains } from "../edge-logs/queries";
import { BLOCKLIST_CATALOG, catalogBySlug } from "./catalog";
import { cscliRead, cscliRun } from "./cscli";
import { blockIp, blockManyIps, unblockIp } from "./decision";
import { configured, fetchDecisions } from "./decisions-read";
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

  blockMany: orgScopedProcedure.firewall.blockMany.handler(async ({ input, context }) => {
    context.log.set({ target: { type: "ip", id: `${input.ips.length} ips` } });
    const reason = input.reason?.trim() || `manual:${context.session?.user?.id ?? "operator"}`;
    const res = await blockManyIps(input.ips, input.durationHours, reason);
    return { ok: res.ok, blocked: res.blocked, error: res.error ?? null };
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
