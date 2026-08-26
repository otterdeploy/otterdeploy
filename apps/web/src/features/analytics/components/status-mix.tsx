/**
 * Response-status mix, as the body of the Traffic tab's Responses card: one
 * stacked proportion bar over the window, then each status class expanding
 * to its exact codes ranked by count. "Other" (status 0: client gone before
 * a response, or out-of-range) is counted and shown apart so the four class
 * shares still add up.
 *
 * Colour is the semantic state vocabulary from the tokens: success / info /
 * warning / destructive. Status colour is state, never series identity.
 */

import { useTranslation } from "react-i18next";

import { cn } from "@/shared/lib/utils";

import {
  formatCount,
  formatShare,
  groupStatuses,
  type StatusClassKey,
  type TopEntry,
} from "../analytics-model";

const CLASS_BG: Record<StatusClassKey, string> = {
  "2xx": "bg-success",
  "3xx": "bg-info",
  "4xx": "bg-warning",
  "5xx": "bg-destructive",
  other: "bg-muted-foreground/40",
};

const CLASS_TEXT: Record<StatusClassKey, string> = {
  "2xx": "text-success",
  "3xx": "text-info",
  "4xx": "text-warning",
  "5xx": "text-destructive",
  other: "text-muted-foreground",
};

export function StatusMix({ entries }: { entries: readonly TopEntry[] }) {
  const { t } = useTranslation();
  const groups = groupStatuses(entries);
  const total = groups.reduce((s, group) => s + group.total, 0);

  if (total === 0) {
    return (
      <p className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
        {t("analytics.overview.noData")}
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-1.5 py-1">
      {/* The proportion bar: 2px gaps between segments so classes read as
          discrete quantities, not one gradient. */}
      <div className="flex h-1.5 w-full shrink-0 gap-0.5 overflow-hidden rounded-full">
        {groups.map((group) => (
          <span
            key={group.cls}
            className={cn("h-full rounded-full", CLASS_BG[group.cls])}
            style={{ width: `${(group.total / total) * 100}%`, minWidth: "3px" }}
            title={`${group.cls}: ${formatShare(group.total, total)}`}
          />
        ))}
      </div>

      <ul className="flex flex-col gap-1.5">
        {groups.map((group) => (
          <li key={group.cls}>
            <div className="flex items-baseline justify-between gap-3">
              <span className={cn("font-mono text-xs font-medium", CLASS_TEXT[group.cls])}>
                {group.cls === "other" ? t("analytics.traffic.noClass") : group.cls}
              </span>
              <span className="flex items-baseline gap-3 font-mono text-xs tabular-nums">
                <span>{formatCount(group.total)}</span>
                <span className="w-12 text-right text-[11px] text-muted-foreground">
                  {formatShare(group.total, total)}
                </span>
              </span>
            </div>
            <ul className="flex flex-col">
              {group.codes.map((code) => (
                <li
                  key={code.key}
                  className="flex items-baseline justify-between gap-3 py-0.5 pl-3 text-[11px]"
                >
                  <span className="font-mono text-muted-foreground">
                    {code.key === "0" ? t("analytics.traffic.noResponse") : code.key}
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
  );
}
