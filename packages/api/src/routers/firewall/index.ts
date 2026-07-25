/**
 * Firewall router — CrowdSec decisions (read via LAPI, see decisions-read.ts),
 * block/unblock actions, flagged-IP review, and managed blocklists. Global
 * CrowdSec reads require installation-admin access; mutations additionally
 * require the active organization's firewall:update capability.
 */

import type { BlocklistId } from "@otterdeploy/shared/id";

import { requireInstallAdmin, requireInstallAdminPermission, requirePermission } from "../..";
import { flaggedIps } from "../../edge-logs/threat-scan";
import { validatePublicHttpUrl } from "../../security/public-fetch";
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
import { clearBlocklist, syncBlocklist, validateBlocklistSource } from "./sync";

const globalFirewallRead = requireInstallAdmin();
const globalFirewallWrite = requireInstallAdminPermission({ firewall: ["update"] });

export const firewallRouter = {
  status: globalFirewallRead.firewall.status.handler(async () => {
    // Reachable = the agent answered `cscli lapi status` over the Docker exec.
    const lapi = await cscliRead("cscli lapi status");
    return {
      configured: configured(),
      reachable: lapi !== null,
    };
  }),

  decisions: globalFirewallRead.firewall.decisions.handler(async () => {
    return (await fetchDecisions()) ?? [];
  }),

  block: globalFirewallWrite.firewall.block.handler(async ({ input, context, errors }) => {
    context.log.set({ target: { type: "ip", id: input.ip } });
    const reason = input.reason?.trim() || `manual:${context.session?.user?.id ?? "operator"}`;
    const res = await blockIp(input.ip, input.durationHours, reason);
    if (!res.ok) throw errors.APPLY_FAILED({ message: res.error });
    return { ok: res.ok, error: res.error ?? null };
  }),

  blockMany: globalFirewallWrite.firewall.blockMany.handler(async ({ input, context, errors }) => {
    context.log.set({ target: { type: "ip", id: `${input.ips.length} ips` } });
    const reason = input.reason?.trim() || `manual:${context.session?.user?.id ?? "operator"}`;
    const res = await blockManyIps(input.ips, input.durationHours, reason);
    context.log.set({ firewall: { requested: input.ips.length, applied: res.blocked } });
    if (!res.ok || res.blocked !== input.ips.length) {
      throw errors.APPLY_FAILED({
        message: res.error ?? `CrowdSec blocked ${res.blocked} of ${input.ips.length} addresses.`,
      });
    }
    return { ok: res.ok, blocked: res.blocked, error: res.error ?? null };
  }),

  unblock: globalFirewallWrite.firewall.unblock.handler(async ({ input, context, errors }) => {
    context.log.set({ target: { type: "ip", id: input.ip } });
    const res = await unblockIp(input.ip);
    if (!res.ok) throw errors.APPLY_FAILED({ message: res.error });
    return { ok: res.ok, error: res.error ?? null };
  }),

  flagged: requirePermission({ firewall: ["read"] }).firewall.flagged.handler(
    async ({ input, context }) => {
      const hosts = await listOrgDomains(context.activeOrganizationId);
      const sinceMs = Date.now() - input.windowMinutes * 60_000;
      return flaggedIps(hosts, sinceMs, 100);
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
        const id = input.id as BlocklistId;
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
        const id = input.id as BlocklistId;
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
        const id = input.id as BlocklistId;
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
          (ok
            ? "Enrollment requested — accept the instance in the console."
            : "Enrollment failed.");
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
