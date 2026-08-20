/**
 * The Deployments page's headline strip: four honest numbers over the active
 * filter window, rendered through the SAME StatStrip card the analytics page
 * uses so the two pages share one stat vocabulary. Computed server-side over
 * every filter except status (see the contract's stats schema); if the query
 * hasn't resolved yet the strip simply isn't rendered — never placeholders.
 */

import { formatNumber } from "@otterdeploy/shared/format";

import { StatStrip, type Stat } from "@/features/analytics/components/stat-strip";
import { formatDuration } from "@/shared/lib/duration";

import type { DeployWindow, ProjectDeploymentStats } from "../data/deployments-search";

const WINDOW_SHORT: Record<DeployWindow, string> = {
  "24h": "24h",
  "7d": "7d",
  "30d": "30d",
  all: "all time",
};

export function DeploymentsStats({
  stats,
  window,
}: {
  stats: ProjectDeploymentStats;
  window: DeployWindow;
}) {
  const failureRate = stats.windowTotal === 0 ? null : (stats.failed / stats.windowTotal) * 100;
  const items: Stat[] = [
    {
      label: `Deploys · ${WINDOW_SHORT[window]}`,
      value: formatNumber(stats.windowTotal),
    },
    {
      label: "Failure rate",
      value: failureRate === null ? "–" : `${failureRate.toFixed(failureRate < 10 ? 1 : 0)}%`,
      sub: stats.failed > 0 ? `${formatNumber(stats.failed)} failed` : undefined,
    },
    {
      label: "Median duration",
      value: stats.medianDurationMs === null ? "–" : formatDuration(stats.medianDurationMs),
      title: "Median wall time of completed deploys in the window.",
    },
    {
      label: "In flight",
      value: formatNumber(stats.inFlight),
    },
  ];
  return <StatStrip stats={items} />;
}
