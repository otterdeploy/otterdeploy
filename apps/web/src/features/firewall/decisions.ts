/**
 * What CrowdSec is enforcing right now, as a collection — plus the three writes
 * that change it.
 *
 * Every one of these used to be a `useMutation` whose `isPending` was a single
 * boolean shared by every row of a table. Blocking one address therefore
 * disabled the Block button on all the others, and nothing at all happened on
 * screen until the round-trip finished and the poll came round: the row an
 * operator clicked kept saying "Block" for a second or two, which is exactly
 * long enough to click it again.
 *
 * So the live decision set is a collection and the writes are transactions over
 * it. `blockIps` inserts the ban locally and calls the API from the
 * transaction's `mutationFn`; `unblockIp` deletes locally and does the same.
 * The row flips the instant you click, every other row stays live, and if the
 * server refuses (agent down, self-block guard) TanStack DB rolls the row back
 * and the toast says why. There is no pending flag to share because there is
 * nothing to wait for.
 *
 * DELIBERATELY NOT PERSISTED — no `persistedCollectionOptions`, unlike
 * projects/registries. This is a live security answer with a 15s poll behind
 * it; replaying yesterday's bans out of OPFS on load would tell an operator
 * that an address is blocked when it expired overnight. The one question this
 * view exists to answer honestly is "what is blocked THIS SECOND", and a disk
 * cache can only lie about it.
 */
import type { InferRouterOutputs } from "@orpc/server";
import type { AppRouter } from "@otterdeploy/api/routers/index";

import { PERMANENT_BAN_HOURS } from "@otterdeploy/api/routers/firewall/contract";
import { Temporal } from "@otterdeploy/shared/temporal";
import { createCollection, createTransaction } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { useLiveQuery } from "@tanstack/react-db";
import { useRouteContext } from "@tanstack/react-router";
import { toast } from "sonner";

import { orpc, queryClient } from "@/shared/server/orpc";

export type Decision = InferRouterOutputs<AppRouter>["firewall"]["decisions"][number];

/** What a one-click Block from a table applies: the contract's own default,
 *  restated here so the optimistic row shows the same length the server will. */
export const DEFAULT_BAN_HOURS = 720;

/** Re-exported so every ban-length decision in the UI reads one number, and
 *  that number is the contract's. */
export { PERMANENT_BAN_HOURS };

/**
 * A live decision's identity.
 *
 * The LAPI hands out numeric ids, but a row we have only just invented
 * optimistically has none yet — so it is keyed by what it bans instead. The two
 * never collide (one is a number, the other a `scope:value` string) and they
 * never overlap in time either: the transaction's write awaits the refetch that
 * replaces the optimistic row with the server's, so the pending key is gone
 * before the real one arrives.
 */
function decisionKey(d: Decision): string | number {
  return d.id ?? `pending:${d.scope.toLowerCase()}:${d.value}`;
}

/** Is this decision an IP ban on `ip`? The unit both writes work in: `unblock`
 *  clears every decision targeting one address, and the Flagged tab's "already
 *  blocked" marker asks the same question. */
export function bansIp(d: Decision, ip: string): boolean {
  return d.scope.toLowerCase() === "ip" && d.value === ip;
}

/** The row the UI shows between the click and the server's answer. Shaped like
 *  a real `cscli`-origin manual decision, because that is what it is about to
 *  become — only the id and the alert enrichment are still unknown. */
function pendingBan(ip: string, durationHours: number): Decision {
  return {
    id: null,
    origin: "cscli",
    type: "ban",
    scope: "Ip",
    value: ip,
    duration: `${durationHours}h`,
    scenario: "manual",
    country: null,
    asNumber: null,
    asName: null,
    eventsCount: null,
    createdAt: Temporal.Now.instant().toString(),
  };
}

const decisionsCollectionOptions = queryCollectionOptions({
  id: "firewall-decisions",
  // The same query key the rest of the app invalidates (`orpc.firewall.key()`
  // from the Refresh button), so a manual refresh still reaches the collection
  // instead of only the queries that used to read this endpoint.
  queryKey: orpc.firewall.decisions.queryKey(),
  queryFn: () => orpc.firewall.decisions.call(),
  // A stale answer here is a wrong answer, so it polls; the poll is also what
  // makes an optimistic row safe, since anything we got wrong is corrected
  // within the tick.
  refetchInterval: 15_000,
  staleTime: 15_000,
  queryClient,
  getKey: decisionKey,
});

export const decisionsCollection = createCollection(decisionsCollectionOptions);

/** Drop the optimistic overlay by making the server's answer current. Awaited
 *  inside every write so a transaction is only "persisted" once the collection
 *  actually holds the real rows. */
async function syncDecisions(): Promise<void> {
  await decisionsCollection.utils.refetch();
}

/**
 * Ban one or more addresses, optimistically.
 *
 * One transaction whichever it is, so a sweep of eighty addresses is one
 * rollback if it fails rather than eighty. The API call differs though: a
 * single deliberate block gets `block`, which can answer with the self-block
 * refusal for the address you are sitting behind; a sweep gets `blockMany`,
 * which silently drops those and reports how many it skipped.
 */
export function blockIps(ips: readonly string[], durationHours = DEFAULT_BAN_HOURS): void {
  // Two rows may not share a key, and an optimistic ban is keyed by the address
  // it bans — so a repeated address, or one whose previous block has not come
  // back from the server yet, would throw out of the click handler. Bans that
  // are already REAL are deliberately not filtered: re-blocking a banned
  // address is how an operator escalates thirty days to permanent.
  const pending = new Set(
    decisionsCollection.toArray.flatMap((d) =>
      d.id === null && d.scope.toLowerCase() === "ip" ? [d.value] : [],
    ),
  );
  const targets = [...new Set(ips)].filter((ip) => !pending.has(ip));
  if (targets.length === 0) return;
  const single = targets.length === 1 ? targets[0] : undefined;

  const tx = createTransaction({
    mutationFn: async () => {
      if (single !== undefined) {
        const res = await orpc.firewall.block.call({ ip: single, durationHours });
        if (!res.ok) throw new Error(res.error ?? "Block failed");
        toast.success(
          `Blocked ${single}${durationHours === PERMANENT_BAN_HOURS ? " forever" : ""}`,
        );
      } else {
        const res = await orpc.firewall.blockMany.call({ ips: targets, durationHours });
        if (!res.ok) throw new Error(res.error ?? "Block failed");
        // The server drops any target someone is signed in from before it bans
        // anything (routers/firewall/self-block-guard). Say so: a sweep that
        // quietly blocks fewer addresses than the button offered looks like it
        // lost them.
        const skipped =
          res.skipped > 0
            ? `${res.skipped} skipped — someone is signed in from ${res.skipped === 1 ? "it" : "them"}`
            : undefined;
        if (res.blocked === 0) toast.info("Nothing was blocked", { description: skipped });
        else {
          toast.success(`Blocked ${res.blocked} IP${res.blocked === 1 ? "" : "s"}`, {
            description: skipped,
          });
        }
      }
      await syncDecisions();
    },
  });

  tx.mutate(() => {
    for (const ip of targets) decisionsCollection.insert(pendingBan(ip, durationHours));
  });
  tx.isPersisted.promise.catch((err: unknown) =>
    toast.error(err instanceof Error ? err.message : "Block failed"),
  );
}

/**
 * Lift every ban on one address, optimistically.
 *
 * `unblock` removes every decision targeting the IP — a community-blocklist ban
 * and a manual one on the same address both go — so the local delete has to
 * remove all of them too, or the row would come back on the next poll and read
 * as the unblock having failed.
 */
export function unblockIp(ip: string): void {
  const keys = decisionsCollection.toArray.filter((d) => bansIp(d, ip)).map(decisionKey);
  if (keys.length === 0) return;

  const tx = createTransaction({
    mutationFn: async () => {
      const res = await orpc.firewall.unblock.call({ ip });
      if (!res.ok) throw new Error(res.error ?? "Unblock failed");
      toast.success(`Unblocked ${ip}`);
      await syncDecisions();
    },
  });

  tx.mutate(() => decisionsCollection.delete(keys));
  tx.isPersisted.promise.catch((err: unknown) =>
    toast.error(err instanceof Error ? err.message : "Unblock failed"),
  );
}

/**
 * May the viewer read or write CrowdSec decisions at all?
 *
 * The whole surface is install-scoped: `firewall.decisions` is
 * `requireInstallAdmin()` and the writes are `requireInstallAdminPermission`.
 * The edge-log planes that show ban markers are NOT admin-only, so without this
 * gate an ordinary member's page would 403 on a fifteen-second poll behind a
 * screen they are perfectly entitled to see.
 */
export function useCanBlock(): boolean {
  return useRouteContext({ from: "/_app", select: (c) => c.isInstallAdmin });
}

/**
 * Every live decision, optimistic rows included.
 *
 * Subscribing is what starts the collection syncing, so the gate has to live
 * here rather than at the call site: a disabled live query returns no rows,
 * which is the right answer for a member — no ban markers, no block buttons,
 * and no request.
 */
export function useDecisions(enabled: boolean): {
  decisions: readonly Decision[];
  /** First sync, nothing to show yet. Never true for a member, who is not
   *  waiting for anything — they were never going to be told. */
  loading: boolean;
} {
  const { data, isLoading } = useLiveQuery(
    (q) => (enabled ? q.from({ decision: decisionsCollection }) : undefined),
    [enabled],
  );
  return { decisions: data ?? [], loading: enabled && isLoading };
}

/** The set of IP-scoped banned addresses, for rows that only need to ask
 *  "is this one blocked". */
export function useBannedIps(enabled: boolean): ReadonlySet<string> {
  const { decisions } = useDecisions(enabled);
  return new Set(decisions.flatMap((d) => (d.scope.toLowerCase() === "ip" ? [d.value] : [])));
}
