/**
 * Periodic blocklist refresher. On each tick it re-imports every enabled list
 * whose `intervalMinutes` has elapsed, so the imported decisions are refreshed
 * before they expire (`durationHours`). Mirrors the metrics sampler's start/stop
 * shape; wired into the server bootstrap. See docs/designs/deployment-protection.md.
 */
import { Result } from "better-result";
import { log } from "evlog";

import { recordSystemAudit } from "../../audit/system";
import { listBlocklistsDue } from "./queries";
import { syncBlocklist } from "./sync";

let running = false;

/**
 * One pass: sync every due list. Returns the count synced, or an error message.
 * Self-guards against overlap (returns Ok(0) if a pass is already in flight).
 */
async function runDueBlocklistSyncs(): Promise<Result<number, string>> {
  if (running) return Result.ok(0);
  running = true;
  const result = await Result.tryPromise({
    try: async () => {
      const due = await listBlocklistsDue(new Date());
      let synced = 0;
      for (const row of due) {
        try {
          const outcome = await syncBlocklist(row);
          if (outcome.ok) synced++;
          await recordSystemAudit({
            action: "firewall.blocklist.sync",
            outcome: outcome.ok ? "success" : "failure",
            reason: outcome.error,
            target: { type: "blocklist", id: row.id },
          });
        } catch (cause) {
          const reason = cause instanceof Error ? cause.message : String(cause);
          await recordSystemAudit({
            action: "firewall.blocklist.sync",
            outcome: "failure",
            reason,
            target: { type: "blocklist", id: row.id },
          });
          log.error({ blocklist: { step: "sync", id: row.id, status: "error" }, error: reason });
        }
      }
      return synced;
    },
    catch: (e) => (e instanceof Error ? e.message : String(e)),
  });
  running = false;
  return result;
}

/** Run a pass and report its outcome. */
function tick(): void {
  void runDueBlocklistSyncs().then((result) =>
    result.match({
      ok: (count) => {
        if (count > 0) log.info({ blocklist: { step: "sync", count } });
      },
      err: (error) => log.error({ blocklist: { step: "sync", status: "error" }, error }),
    }),
  );
}

/** Start the periodic refresher. Returns a stop handle. */
export function startBlocklistScheduler(intervalMs = 5 * 60_000): () => void {
  // First pass shortly after boot, then on the interval.
  const kickoff = setTimeout(tick, 20_000);
  kickoff.unref?.();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => {
    clearTimeout(kickoff);
    clearInterval(timer);
  };
}
