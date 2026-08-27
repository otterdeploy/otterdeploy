/**
 * Records what CrowdSec decides, so the record outlives the decision.
 *
 * CrowdSec's decisions are short-lived by design: a ban carries a duration and
 * the engine drops it when that elapses. The Firewall view reads them live, so
 * an expired ban vanishes from the page and takes with it any evidence the IP
 * was ever a problem. Look an hour after an SSH brute-force and the table is
 * empty — which reads as "nothing happened" rather than "it ended".
 *
 * Each pass diffs the live LAPI set against what we have open:
 *
 *   seen now, no open row   → insert (first_seen_at = now)
 *   seen now, open row      → touch last_seen_at
 *   open row, not seen now  → stamp ended_at
 *
 * Deliberately NOT `/v1/alerts`, which is where CrowdSec keeps the history
 * already: that endpoint pins the LAPI at full CPU indefinitely once a large
 * imported-blocklist alert exists (observed on v1.7.8, see ./decisions-read).
 * Polling the cheap endpoint and keeping our own record costs one table and
 * avoids the trap entirely.
 *
 * Nothing here enforces anything. CrowdSec's own store is what the bouncers
 * read; dropping every row in this table would cost history and change no
 * traffic.
 */
import type { FirewallDecisionId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { firewallDecision } from "@otterdeploy/db/schema";
import { Result } from "better-result";
import { and, inArray, isNull, sql } from "drizzle-orm";
import { log } from "evlog";

import { decisionIdentity, rowIdentity } from "./decision-identity";
import { fetchDecisions } from "./decisions-read";

interface RecordSummary {
  opened: number;
  stillOpen: number;
  ended: number;
}

/**
 * One pass. Returns what changed, or an error string — never throws, because
 * the caller is a timer and a transient LAPI hiccup must not take the process
 * with it.
 */
async function recordDecisionsOnce(): Promise<Result<RecordSummary, string>> {
  const live = await fetchDecisions();
  // Null means the LAPI could not be read at all. Do NOT treat that as "every
  // decision ended": a restarting agent would otherwise close every open row
  // and the history would read as a mass expiry that never happened.
  if (!live) return Result.err("crowdsec is not reachable");

  return Result.tryPromise({
    try: async () => {
      const open = await db.select().from(firewallDecision).where(isNull(firewallDecision.endedAt));
      const openByIdentity = new Map(open.map((row) => [rowIdentity(row), row]));

      const now = new Date();
      const seen = new Set<string>();
      const fresh: (typeof firewallDecision.$inferInsert)[] = [];
      const touch: FirewallDecisionId[] = [];

      for (const decision of live) {
        const identity = decisionIdentity(decision);
        // The LAPI can return the same target from two sources (a local
        // scenario and an imported list). Both are the same fact to us.
        if (seen.has(identity)) continue;
        seen.add(identity);

        const existing = openByIdentity.get(identity);
        if (existing) {
          touch.push(existing.id);
          continue;
        }
        fresh.push({
          lapiId: decision.id,
          value: decision.value,
          scope: decision.scope,
          type: decision.type,
          scenario: decision.scenario,
          origin: decision.origin,
          duration: decision.duration,
          country: decision.country,
          asNumber: decision.asNumber,
          asName: decision.asName,
          eventsCount: decision.eventsCount,
          firstSeenAt: now,
          lastSeenAt: now,
        });
      }

      if (fresh.length > 0) {
        // A concurrent pass (or a manual block that raced this one) can insert
        // the same LAPI id. The unique index makes that a no-op rather than a
        // failed pass.
        await db.insert(firewallDecision).values(fresh).onConflictDoNothing();
      }
      if (touch.length > 0) {
        await db
          .update(firewallDecision)
          .set({ lastSeenAt: now })
          .where(inArray(firewallDecision.id, touch));
      }

      // Everything still open that this pass did not see has ended. Scoped to
      // the rows that were open BEFORE this pass, so the ones just inserted
      // (live by definition, and not in `touch`) can't be closed by the same
      // statement that created them.
      const staleIds = open.filter((row) => !touch.includes(row.id)).map((row) => row.id);
      // `ended_at` is stamped as `last_seen_at`, not `now`: the decision
      // stopped being enforced somewhere between the two polls, and the last
      // moment we can actually vouch for is when we last saw it.
      const ended =
        staleIds.length > 0
          ? await db
              .update(firewallDecision)
              .set({ endedAt: sql`${firewallDecision.lastSeenAt}` })
              .where(and(inArray(firewallDecision.id, staleIds), isNull(firewallDecision.endedAt)))
              .returning({ id: firewallDecision.id })
          : [];

      return {
        opened: fresh.length,
        stillOpen: touch.length,
        ended: ended.length,
      };
    },
    catch: (error) => (error instanceof Error ? error.message : String(error)),
  });
}

let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

/**
 * Start the recorder. Every tick diffs live decisions against our open rows.
 *
 * 60s is chosen against what it is recording, not what a UI wants: CrowdSec's
 * shortest common ban is minutes, so a minute's resolution loses nothing
 * meaningful, and the LAPI call it makes is the same cheap one the bouncers
 * poll far more often than this.
 */
export function startFirewallRecorder(intervalMs = 60_000): () => void {
  if (timer) return stopFirewallRecorder;
  const tick = () => {
    // Self-guard rather than queue: if a pass is slow, skipping is correct —
    // the next one sees the same live set and reaches the same conclusion.
    if (inFlight) return;
    inFlight = true;
    void recordDecisionsOnce()
      .then((result) => {
        if (result.isErr()) {
          // Expected whenever the firewall profile is simply not running.
          log.debug({ firewall: { recorder: "skipped", reason: result.error } });
          return;
        }
        const { opened, ended } = result.value;
        if (opened > 0 || ended > 0) {
          log.info({ firewall: { recorder: "pass", ...result.value } });
        }
      })
      .finally(() => {
        inFlight = false;
      });
  };
  timer = setInterval(tick, intervalMs);
  // Don't hold the process open for a background recorder.
  timer.unref?.();
  tick();
  return stopFirewallRecorder;
}

function stopFirewallRecorder(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
