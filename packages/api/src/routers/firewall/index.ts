/**
 * Firewall router: CrowdSec decisions (read via LAPI, see decisions-read.ts),
 * block/unblock actions, flagged-IP review, and managed blocklists. Global
 * CrowdSec reads require installation-admin access; mutations additionally
 * require the active organization's firewall:update capability.
 */

import { hasPrefix, ID_PREFIX, type BlocklistId } from "@otterdeploy/shared/id";

import { requireInstallAdmin, requireInstallAdminPermission, requirePermission } from "../..";
// The bounded flagged-IP windows are a subset of the edge-log time ranges, so
// they share one source of truth for how long each one is.
import { RANGE_MS as FLAGGED_WINDOW_MS } from "../../edge-logs/ring";
import { flaggedIps, flaggedIpsAllTime } from "../../edge-logs/threat-scan";
import { validatePublicHttpUrl } from "../../security/public-fetch";
import { listOrgDomains } from "../edge-logs/queries";
import { BLOCKLIST_CATALOG, catalogBySlug } from "./catalog";
import { cscliRead, cscliRun } from "./cscli";
import { decisionHandlers } from "./decision-handlers";
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
import { recordedHandlers } from "./recorded-handlers";
import { clearBlocklist, syncBlocklist, validateBlocklistSource } from "./sync";

const globalFirewallRead = requireInstallAdmin();
const globalFirewallWrite = requireInstallAdminPermission({ firewall: ["update"] });

export const firewallRouter = {
  ...recordedHandlers,
  ...decisionHandlers,
  status: globalFirewallRead.firewall.status.handler(async () => {
    // Reachable = the agent answered `cscli lapi status` over the Docker exec.
    const lapi = await cscliRead("cscli lapi status");
    return {
      configured: await configured(),
      reachable: lapi !== null,
    };
  }),

  decisions: globalFirewallRead.firewall.decisions.handler(async () => {
    return (await fetchDecisions()) ?? [];
  }),

  flagged: requirePermission({ firewall: ["read"] }).firewall.flagged.handler(
    async ({ input, context }) => {
      const hosts = await listOrgDomains(context.activeOrganizationId);
      // `all` reads the durable rollup (survives the raw log's retention
      // sweep); the bounded windows aggregate the raw rows, which carry the
      // per-request detail a window view implies.
      if (input.window === "all") return flaggedIpsAllTime(hosts, 100);
      return flaggedIps(hosts, Date.now() - FLAGGED_WINDOW_MS[input.window], 100);
    },
  ),

  blocklists: {
    list: globalFirewallRead.firewall.blocklists.list.handler(async () => {
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

    addCustom: globalFirewallWrite.firewall.blocklists.addCustom.handler(
      async ({ input, context, errors }) => {
        let url: string;
        try {
          url = validatePublicHttpUrl(input.url).toString();
        } catch (cause) {
          throw errors.INVALID_INPUT({
            message: cause instanceof Error ? cause.message : "Invalid blocklist URL.",
          });
        }
        if (await findBlocklistByUrl(url)) throw errors.CONFLICT();
        let entries: string[];
        try {
          entries = await validateBlocklistSource(url);
        } catch (cause) {
          throw errors.INVALID_INPUT({
            message: cause instanceof Error ? cause.message : "Invalid blocklist URL.",
          });
        }
        const row = await insertBlocklist({
          name: input.name.trim(),
          url,
          durationHours: input.durationHours,
          intervalMinutes: input.intervalMinutes,
        });
        context.log.set({ target: { type: "blocklist", id: row.id }, blocklist: { url } });
        const result = await syncBlocklist(row, entries);
        if (!result.ok) {
          await deleteBlocklist(row.id);
          throw errors.APPLY_FAILED({ message: result.error });
        }
        return toBlocklistView((await getBlocklist(row.id)) ?? row);
      },
    ),

    enableCatalog: globalFirewallWrite.firewall.blocklists.enableCatalog.handler(
      async ({ input, context, errors }) => {
        const entry = catalogBySlug(input.slug);
        if (!entry) throw errors.INVALID_INPUT({ message: "Unknown list." });
        if (await findBlocklistByCatalog(entry.slug)) throw errors.CONFLICT();
        let entries: string[];
        try {
          entries = await validateBlocklistSource(entry.url);
        } catch (cause) {
          throw errors.INVALID_INPUT({
            message: cause instanceof Error ? cause.message : "Unable to validate blocklist.",
          });
        }
        const row = await insertBlocklist({
          name: entry.name,
          url: entry.url,
          catalogSlug: entry.slug,
          durationHours: entry.durationHours,
          intervalMinutes: entry.intervalMinutes,
        });
        context.log.set({ target: { type: "blocklist", id: row.id } });
        const result = await syncBlocklist(row, entries);
        if (!result.ok) {
          await deleteBlocklist(row.id);
          throw errors.APPLY_FAILED({ message: result.error });
        }
        return toBlocklistView((await getBlocklist(row.id)) ?? row);
      },
    ),

    toggle: globalFirewallWrite.firewall.blocklists.toggle.handler(
      async ({ input, context, errors }) => {
        // The contract carries a plain string; a non-`blk_` id can't be a row,
        // so it gets the same NOT_FOUND the DB miss would produce.
        if (!hasPrefix(input.id, ID_PREFIX.blocklist)) throw errors.NOT_FOUND();
        const id: BlocklistId = input.id;
        const existing = await getBlocklist(id);
        if (!existing) throw errors.NOT_FOUND();
        context.log.set({
          target: { type: "blocklist", id },
          blocklist: { enabled: input.enabled },
        });
        if (existing.enabled === input.enabled) return toBlocklistView(existing);
        if (!input.enabled && !(await clearBlocklist(existing))) {
          throw errors.APPLY_FAILED({
            message: "CrowdSec could not clear this blocklist; it remains enabled.",
          });
        }
        const row = await setBlocklistEnabled(id, input.enabled);
        if (!row) throw errors.NOT_FOUND();
        if (input.enabled) {
          const result = await syncBlocklist(row);
          if (!result.ok) {
            await setBlocklistEnabled(id, false);
            throw errors.APPLY_FAILED({ message: result.error });
          }
        }
        return toBlocklistView((await getBlocklist(id)) ?? row);
      },
    ),

    remove: globalFirewallWrite.firewall.blocklists.remove.handler(
      async ({ input, context, errors }) => {
        if (!hasPrefix(input.id, ID_PREFIX.blocklist)) throw errors.NOT_FOUND();
        const id: BlocklistId = input.id;
        const row = await getBlocklist(id);
        if (!row) throw errors.NOT_FOUND();
        context.log.set({ target: { type: "blocklist", id } });
        if (!(await clearBlocklist(row))) {
          throw errors.APPLY_FAILED({
            message: "CrowdSec could not clear this blocklist; nothing was deleted.",
          });
        }
        await deleteBlocklist(id);
        return { ok: true };
      },
    ),

    syncNow: globalFirewallWrite.firewall.blocklists.syncNow.handler(
      async ({ input, context, errors }) => {
        if (!hasPrefix(input.id, ID_PREFIX.blocklist)) throw errors.NOT_FOUND();
        const id: BlocklistId = input.id;
        const row = await getBlocklist(id);
        if (!row) throw errors.NOT_FOUND();
        context.log.set({ target: { type: "blocklist", id } });
        const result = await syncBlocklist(row);
        if (!result.ok) throw errors.APPLY_FAILED({ message: result.error });
        return { ok: result.ok, count: result.count, error: result.error ?? null };
      },
    ),
  },

  console: {
    status: globalFirewallRead.firewall.console.status.handler(async () => {
      return { available: (await cscliRead("cscli lapi status")) !== null };
    }),

    enroll: globalFirewallWrite.firewall.console.enroll.handler(
      async ({ input, context, errors }) => {
        context.log.set({ target: { type: "crowdsec-console", id: "installation" } });
        // Key passed as a positional arg ($1), never interpolated into the shell.
        const out = await cscliRun('cscli console enroll "$1"', [input.key.trim()]);
        if (out === null) {
          throw errors.INVALID_INPUT({
            message: "CrowdSec agent isn't running.",
          });
        }
        const ok = !/error|invalid|failed|denied/i.test(out);
        const message =
          out.trim().split("\n").filter(Boolean).slice(-2).join(" ").slice(0, 300) ||
          (ok ? "Enrollment requested: accept the instance in the console." : "Enrollment failed.");
        if (!ok) throw errors.INVALID_INPUT({ message });
        return { ok, message };
      },
    ),
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
