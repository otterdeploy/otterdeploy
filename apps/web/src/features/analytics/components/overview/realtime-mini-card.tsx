/**
 * The overview's realtime teaser: the live count large, the top five paths
 * right now, and the road to the full Realtime view. Polls with the page's
 * 30 s cadence — the dedicated view is where the 10 s cadence lives.
 */

import { useTranslation } from "react-i18next";

import { Skeleton } from "@/shared/components/ui/skeleton";

import { formatCount } from "../../analytics-model";
import { type AnalyticsScope, useRealtime } from "../../hooks/use-web-analytics";

export function RealtimeMiniCard({
  scope,
  onShowRealtime,
}: {
  scope: AnalyticsScope;
  onShowRealtime: () => void;
}) {
  const { t } = useTranslation();
  const query = useRealtime(scope, { pollMs: 30_000 });
  const data = query.data;

  return (
    <section className="flex h-[16.25rem] flex-col rounded-lg bg-card ring-1 ring-foreground/10 md:h-auto">
      <header className="flex min-h-11 items-center justify-between gap-2 border-b border-border px-3.5 py-2">
        <h3 className="text-sm font-medium">{t("analytics.overview.realtimeCard")}</h3>
        <button
          type="button"
          onClick={onShowRealtime}
          className="text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
        >
          {t("analytics.overview.viewRealtime")}
        </button>
      </header>
      <div className="flex flex-1 flex-col gap-2 px-3.5 py-3">
        <div className="flex items-baseline gap-2">
          {data === undefined ? (
            <Skeleton className="h-8 w-14" />
          ) : (
            <span className="font-mono text-3xl leading-8 font-medium tabular-nums">
              {formatCount(data.liveVisitors)}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {t("analytics.overview.liveVisitors")}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{t("analytics.overview.topPathsNow")}</p>
        <ul className="flex flex-col">
          {data === undefined ? (
            <li className="py-1">
              <Skeleton className="h-3.5 w-full" />
            </li>
          ) : data.byPath.length === 0 ? (
            <li className="py-1 text-xs text-muted-foreground">
              {t("analytics.overview.nobodyNow")}
            </li>
          ) : (
            data.byPath.slice(0, 5).map((entry) => (
              <li key={entry.path} className="flex items-center gap-2 py-1">
                <span className="min-w-0 flex-1 truncate font-mono text-xs" title={entry.path}>
                  {entry.path}
                </span>
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  {formatCount(entry.visitors)}
                </span>
              </li>
            ))
          )}
        </ul>
      </div>
    </section>
  );
}
