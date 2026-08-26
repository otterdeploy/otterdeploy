/**
 * The header's live-visitor badge: a pulsing success dot while anyone is on
 * a tracked site, a quiet grey reading at zero, and an en dash while the
 * count is unknown — three different truths, three different renderings.
 */

import { useTranslation } from "react-i18next";

import { cn } from "@/shared/lib/utils";

import { formatCount } from "../analytics-model";

export function LiveBadge({ live }: { live: number | null }) {
  const { t } = useTranslation();
  const active = live !== null && live > 0;
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1.5 rounded-4xl bg-muted px-2 font-mono text-[11px] font-medium tabular-nums",
        active ? "text-foreground" : "text-muted-foreground",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-full",
          active ? "animate-pulse bg-success motion-reduce:animate-none" : "bg-muted-foreground/40",
        )}
      />
      {live === null ? "–" : t("analytics.liveCount", { count: formatCount(live) })}
    </span>
  );
}
