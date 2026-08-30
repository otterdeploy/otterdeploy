/**
 * The three writes that change what CrowdSec is enforcing: ban one address,
 * ban a batch, lift a ban.
 *
 * Split from index.ts on the file cap, and they belong together anyway: all
 * three are the same permission, the same audit shape, and the same guard
 * against banning the people operating the firewall (./self-block-guard).
 */
import { requireInstallAdminPermission } from "../..";
import { blockIp, blockManyIps, unblockIp } from "./decision";
import { blocksCaller, sweepBlockTargets } from "./self-block-guard";

const globalFirewallWrite = requireInstallAdminPermission({ firewall: ["update"] });

export const decisionHandlers = {
  block: globalFirewallWrite.firewall.block.handler(async ({ input, context, errors }) => {
    context.log.set({ target: { type: "ip", id: input.ip } });
    // Deliberate, single, and typed by a human — so the only thing refused is
    // the one that ends the session doing the refusing. See ./self-block-guard.
    if (blocksCaller(input.ip, context.headers)) {
      context.log.set({ firewall: { refused: "self-block" } });
      throw errors.SELF_BLOCK();
    }
    const reason = input.reason?.trim() || `manual:${context.session?.user?.id ?? "operator"}`;
    const res = await blockIp(input.ip, input.durationHours, reason);
    if (!res.ok) throw errors.APPLY_FAILED({ message: res.error });
    return { ok: res.ok, error: res.error ?? null };
  }),

  blockMany: globalFirewallWrite.firewall.blockMany.handler(async ({ input, context, errors }) => {
    context.log.set({ target: { type: "ip", id: `${input.ips.length} ips` } });
    // A sweep nobody read row by row: drop every address someone is signed in
    // from, and report the count rather than silently blocking fewer.
    const { allowed, skipped } = await sweepBlockTargets(input.ips);
    context.log.set({
      firewall: { requested: input.ips.length, skipped: skipped.length },
    });
    // Everything the sweep offered belongs to a live session. Not a failure:
    // the guard did its job, and the caller needs to hear that it did.
    if (allowed.length === 0) {
      return { ok: true, blocked: 0, skipped: skipped.length, error: null };
    }

    const reason = input.reason?.trim() || `manual:${context.session?.user?.id ?? "operator"}`;
    const res = await blockManyIps(allowed, input.durationHours, reason);
    context.log.set({ firewall: { applied: res.blocked } });
    if (!res.ok || res.blocked !== allowed.length) {
      throw errors.APPLY_FAILED({
        message: res.error ?? `CrowdSec blocked ${res.blocked} of ${allowed.length} addresses.`,
      });
    }
    return { ok: res.ok, blocked: res.blocked, skipped: skipped.length, error: res.error ?? null };
  }),

  unblock: globalFirewallWrite.firewall.unblock.handler(async ({ input, context, errors }) => {
    context.log.set({ target: { type: "ip", id: input.ip } });
    const res = await unblockIp(input.ip);
    if (!res.ok) throw errors.APPLY_FAILED({ message: res.error });
    return { ok: res.ok, error: res.error ?? null };
  }),
};
