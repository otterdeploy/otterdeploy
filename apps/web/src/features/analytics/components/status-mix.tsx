/**
 * Response-status mix: one stacked proportion bar over the window, then each
 * status class expanding to its exact codes ranked by count. "Other"
 * (status 0: client gone before a response, or out-of-range) is counted and
 * shown apart so the four class shares still add up.
 */

import { Card } from "@/shared/components/ui/card";
import { cn } from "@/shared/lib/utils";

import {
  formatCount,
  formatShare,
  groupStatuses,
  type StatusClassKey,
  type TopEntry,
} from "../analytics-model";

/** Same semantic mapping the edge-logs views use (BUCKET_BG), plus a muted
 *  slot for the odd statuses. Status color is state, never series identity. */
const CLASS_BG: Record<StatusClassKey, string> = {
  "2xx": "bg-success",
  "3xx": "bg-sky-500",
  "4xx": "bg-amber-500",
  "5xx": "bg-destructive",
  other: "bg-muted-foreground/40",
};

const CLASS_TEXT: Record<StatusClassKey, string> = {
  "2xx": "text-success",
  "3xx": "text-sky-500",
  "4xx": "text-amber-500",
  "5xx": "text-destructive",
  other: "text-muted-foreground",
};

export function StatusMix({ entries }: { entries: readonly TopEntry[] }) {
  const groups = groupStatuses(entries);
  const total = groups.reduce((s, group) => s + group.total, 0);

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="px-4 pt-3 pb-2">
        <span className="text-sm font-medium">Responses</span>
      </div>
      {total === 0 ? (
        <p className="px-4 pb-4 text-xs text-muted-foreground">No responses in this window.</p>
      ) : (
        <div className="flex flex-col gap-3 px-4 pb-4">
          {/* The proportion bar: 2px gaps between segments so classes read as
              discrete quantities, not one gradient. */}
          <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full">
            {groups.map((group) => (
              <span
                key={group.cls}
                className={cn("h-full rounded-full", CLASS_BG[group.cls])}
                style={{ width: `${(group.total / total) * 100}%`, minWidth: "3px" }}
                title={`${group.cls}: ${formatShare(group.total, total)}`}
              />
            ))}
          </div>

          <ul className="flex flex-col gap-2">
            {groups.map((group) => (
              <li key={group.cls}>
                <div className="flex items-baseline justify-between">
                  <span className={cn("font-mono text-xs font-semibold", CLASS_TEXT[group.cls])}>
                    {group.cls === "other" ? "no class" : group.cls}
                  </span>
                  <span className="flex items-baseline gap-3 font-mono text-xs tabular-nums">
                    <span>{formatCount(group.total)}</span>
                    <span className="w-12 text-right text-[11px] text-muted-foreground">
                      {formatShare(group.total, total)}
                    </span>
                  </span>
                </div>
                <ul className="mt-0.5 flex flex-col">
                  {group.codes.map((code) => (
                    <li
                      key={code.key}
                      className="flex items-baseline justify-between py-0.5 pl-4 text-[11px]"
                    >
                      <span className="font-mono text-muted-foreground">
                        {code.key === "0" ? "0 · no response" : code.key}
                      </span>
                      <span className="flex items-baseline gap-3 font-mono text-muted-foreground tabular-nums">
                        <span>{formatCount(code.count)}</span>
                        <span className="w-12 text-right">{formatShare(code.count, total)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
