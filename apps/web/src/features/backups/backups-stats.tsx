/**
 * One line above the runs table: how many backups, how much is stored, when
 * the last one succeeded and whether anything has failed.
 *
 * It used to be four hero-metric tiles with uppercase eyebrows ("TOTAL
 * BACKUPS 1", "LAST SUCCESSFUL ✓", …) restating the one table row beneath
 * them (impeccable bans both). A sentence carries the same facts at a
 * glance, and says nothing at all when there is no history.
 */
import { epochMsOf } from "@/shared/lib/clock";
import { relativeMs } from "@/shared/lib/time";
import { cn } from "@/shared/lib/utils";

import type { Backup } from "./data/backups";

import { fmtBytes } from "./shared";

/** The two instants the summary reads off a run. */
type RunTimes = Pick<Backup, "completedAt" | "createdAt">;

interface SummaryFacts {
  total: number;
  matchCount: number;
  storedBytes: number;
  lastSuccess: RunTimes | undefined;
  lastFail: RunTimes | undefined;
}

/** When a run settled, falling back to when it was queued. */
function settledAt(b: RunTimes): number {
  return epochMsOf(b.completedAt ?? b.createdAt);
}

/** The summary's parts, in reading order. Exported for the tests. */
export function summaryParts(facts: SummaryFacts): Array<{ text: string; warn?: boolean }> {
  const { total, matchCount, storedBytes, lastSuccess, lastFail } = facts;
  const parts: Array<{ text: string; warn?: boolean }> = [
    { text: `${total} ${total === 1 ? "backup" : "backups"}` },
  ];
  if (matchCount !== total) parts.push({ text: `${matchCount} shown` });
  parts.push({ text: `${fmtBytes(storedBytes)} stored` });
  parts.push({
    text: lastSuccess
      ? `last success ${relativeMs(settledAt(lastSuccess))}`
      : "no successful backup yet",
  });
  parts.push(
    lastFail
      ? { text: `last failure ${relativeMs(settledAt(lastFail))}`, warn: true }
      : { text: "no failures" },
  );
  return parts;
}

export function BackupsStats(facts: SummaryFacts) {
  if (facts.total === 0) return null;
  return (
    <p className="mb-4 text-[13px] text-muted-foreground">
      {summaryParts(facts).map((part, i) => (
        <span key={part.text}>
          {i > 0 && " · "}
          <span className={cn(part.warn && "font-medium text-warning")}>{part.text}</span>
        </span>
      ))}
    </p>
  );
}
