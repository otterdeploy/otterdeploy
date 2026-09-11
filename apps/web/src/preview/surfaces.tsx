/**
 * The five surfaces, in migration order (od-fqhk).
 *
 * Each entry is the real column declaration plus the fixture rows to judge it
 * against. Adding a surface here is the first half of migrating it; the second
 * half is a `createFeedHandler` feed, and nothing about the declaration changes
 * when that lands.
 *
 * The list is heterogeneous — every surface has its own row type — so each
 * entry carries a `render` closing over its own typed spec rather than the list
 * being widened to a common parameter. That keeps `SurfaceSpec<TRow>` honest at
 * each call site, which is where the column declarations get type-checked
 * against their rows.
 */

import type { RowData } from "@tanstack/react-table";

import type { ReactNode } from "react";

import {
  DeploymentRowActions,
  DeploymentSummary,
} from "@/features/deployments/table/deployment-actions";
import {
  DEPLOYMENT_OUTCOME_ORDER,
  DEPLOYMENT_OUTCOME_TONES,
  isInFlight,
  outcomeOf,
} from "@/features/deployments/table/deployment-cells";
import { deploymentColumns } from "@/features/deployments/table/deployment-columns";
import { AccessLogToolbarActions, BlockIpAction } from "@/features/edge-logs/table/access-actions";
import {
  EDGE_ACCESS_STATUS_ORDER,
  EDGE_ACCESS_STATUS_TONES,
} from "@/features/edge-logs/table/access-cells";
import { edgeAccessColumns } from "@/features/edge-logs/table/access-columns";
import {
  edgeEventColumns,
  EDGE_EVENT_LEVEL_ORDER,
  EDGE_EVENT_LEVEL_TONES,
} from "@/features/edge-logs/table/events-columns";
import { DecisionToolbarActions, UnblockAction } from "@/features/firewall/table/decision-actions";
import {
  decisionState,
  FIREWALL_ORIGIN_ORDER,
  FIREWALL_ORIGIN_TONES,
} from "@/features/firewall/table/decision-cells";
import { firewallDecisionColumns } from "@/features/firewall/table/decision-columns";
import { deploymentFixtures } from "@/preview/fixtures/deployments";
import { edgeAccessFixtures } from "@/preview/fixtures/edge-access";
import { edgeEventFixtures } from "@/preview/fixtures/edge-events";
import { firewallDecisionFixtures } from "@/preview/fixtures/firewall-decisions";
import { SurfacePreview, type SurfaceSpec } from "@/preview/surface-preview";
import { ROW_TINT } from "@/shared/components/data-table/parts/row-tint";

export interface Surface {
  id: string;
  /** What this surface is called in the product. */
  title: string;
  /** Where it renders today, so the reviewer knows what they are comparing to. */
  where: string;
  /** What the migration removes. */
  replaces: string;
  render: () => ReactNode;
}

/** Build a rail entry and its preview from one typed spec. */
function surface<TRow extends RowData>(
  spec: SurfaceSpec<TRow>,
  meta: Omit<Surface, "render">,
): Surface {
  return { ...meta, render: () => <SurfacePreview surface={spec} /> };
}

const edgeEvents = surface(
  {
    id: "edge-events",
    columns: edgeEventColumns,
    rows: edgeEventFixtures(),
    getRowId: (row) => row.id,
    rowTitle: (row) => <span className="font-mono">{row.logger}</span>,
    timeOf: (row) => row.ts,
    timeKey: "ts",
    categoryOf: (row) => row.level,
    histogramKey: "level",
    histogramTones: EDGE_EVENT_LEVEL_TONES,
    histogramOrder: EDGE_EVENT_LEVEL_ORDER,
    searchPlaceholder: "Search messages, errors, loggers",
    emptyTitle: "No edge events in this window",
    emptyDescription: "Certificate, upstream and config activity appears here as Caddy reports it.",
    // An error is the row this table exists for, so it carries a tint rather
    // than relying on the level pill alone.
    rowClassName: (row) => (row.level === "error" ? ROW_TINT.danger : undefined),
  },
  {
    id: "edge-events",
    title: "Caddy events",
    where: "Edge → Caddy → Events. Cert lifecycle, upstream health and config reloads.",
    replaces: "edge-events-view.tsx · 159 lines",
  },
);

const edgeAccess = surface(
  {
    id: "edge-access",
    columns: edgeAccessColumns,
    rows: edgeAccessFixtures(),
    getRowId: (row) => row.id,
    rowTitle: (row) => (
      <span className="font-mono">
        {row.method} {row.path}
      </span>
    ),
    timeOf: (row) => row.ts,
    timeKey: "ts",
    // Stacked by status CLASS, not by code: forty distinct codes is a
    // gradient, and the question the histogram answers is "how much of this
    // was failing". `statusClass` is the key the server derives and sends, so
    // clicking a band filters on the same value the bar was drawn from.
    categoryOf: (row) => row.statusClass,
    histogramKey: "statusClass",
    histogramTones: EDGE_ACCESS_STATUS_TONES,
    histogramOrder: EDGE_ACCESS_STATUS_ORDER,
    searchPlaceholder: "Search paths, hosts, IPs, agents",
    emptyTitle: "No requests in this window",
    emptyDescription: "Every request the edge served appears here.",
    rowClassName: (row) => (row.status >= 500 ? ROW_TINT.danger : undefined),
    // The old view's controls, on the shell. Bulk block appears only once the
    // rows in hand are narrowed to probes — see `AccessLogToolbarActions`.
    actions: ({ rows }) => (
      <AccessLogToolbarActions
        rows={rows}
        suspiciousOnly={rows.length > 0 && rows.every((row) => row.suspicious === "yes")}
        onBlockAll={() => Promise.resolve()}
        onExport={() => undefined}
      />
    ),
    rowActions: (row) => <BlockIpAction row={row} onBlockIp={() => Promise.resolve()} />,
  },
  {
    id: "edge-access",
    title: "Edge access logs",
    where: "Edge → Access logs, and the project Logs page's Edge source.",
    replaces: "edge-logs-view.tsx + parts · ~1,900 lines",
  },
);

const firewallDecisions = surface(
  {
    id: "firewall-decisions",
    columns: firewallDecisionColumns,
    rows: firewallDecisionFixtures(),
    getRowId: (row) => row.id,
    rowTitle: (row) => (
      <span className="font-mono">
        {row.type} {row.value}
      </span>
    ),
    timeOf: (row) => Date.parse(row.firstSeenAt),
    timeKey: "firstSeenAt",
    // Stacked by ORIGIN: a spike of `crowdsec` means something reached this
    // install, a spike of `CAPI` means a blocklist synced. Reading the two as
    // one number is how a routine sync gets mistaken for an incident.
    categoryOf: (row) => row.origin,
    histogramKey: "origin",
    histogramTones: FIREWALL_ORIGIN_TONES,
    histogramOrder: FIREWALL_ORIGIN_ORDER,
    searchPlaceholder: "Search addresses, scenarios, networks",
    emptyTitle: "No decisions in this window",
    emptyDescription: "Bans, captchas and throttles appear here as CrowdSec decides them.",
    // A live ban is the row someone came here to find or to lift.
    rowClassName: (row) => (decisionState(row) === "active" ? ROW_TINT.danger : undefined),
    // The preview wires the real controls to no-op promises: the point is to
    // judge where they sit and what they say, not to move a fixture around.
    actions: (
      <DecisionToolbarActions
        lapiReachable
        onBlock={() => Promise.resolve()}
        onRefresh={() => undefined}
      />
    ),
    rowActions: (row) => <UnblockAction row={row} onUnblock={() => Promise.resolve()} />,
  },
  {
    id: "firewall-decisions",
    title: "Firewall decisions",
    where: "Edge → Firewall. Bans, captchas and throttles, live and expired.",
    replaces: "firewall table + toolbar + filters + mobile cards",
  },
);

const deployments = surface(
  {
    id: "deployments",
    columns: deploymentColumns,
    rows: deploymentFixtures(),
    getRowId: (row) => row.id,
    rowTitle: (row) => (
      <span className="font-mono">
        {row.resourceName} · {row.status}
      </span>
    ),
    timeOf: (row) => Date.parse(row.createdAt),
    timeKey: "createdAt",
    // Stacked by OUTCOME, not by status: ten stored statuses is a gradient, and
    // the question a deploy histogram answers is "did the deploys in this
    // window work". See `outcomeOf`.
    categoryOf: (row) => outcomeOf(row.status),
    histogramKey: "status",
    histogramTones: DEPLOYMENT_OUTCOME_TONES,
    histogramOrder: DEPLOYMENT_OUTCOME_ORDER,
    searchPlaceholder: "Search commits, authors, services, images",
    emptyTitle: "No deployments in this window",
    emptyDescription:
      "Every build and deploy across this project lands here. Push to a connected repo, or deploy a resource from the graph.",
    // A failed deploy is the row this page gets opened for.
    rowClassName: (row) => (row.outcome === "failed" ? ROW_TINT.danger : undefined),
    actions: ({ rows }) => (
      <DeploymentSummary
        inFlight={rows.filter((row) => isInFlight(row.status)).length}
        medianDurationMs={medianDuration(rows)}
      />
    ),
    // Cancel, roll back, and the ⋯ menu. Mutually exclusive by definition, so
    // the cell never holds more than two — see `deployment-actions.tsx`.
    rowActions: (row) => (
      <DeploymentRowActions
        row={row}
        onCancel={() => Promise.resolve()}
        onRollback={() => Promise.resolve()}
        onViewLogs={() => undefined}
        onCopyRef={() => undefined}
      />
    ),
  },
  {
    id: "deployments",
    title: "Deployments",
    where: "Project → Deployments. Every build and deploy, across every resource.",
    replaces: "deployments-table + toolbar + stats + pager · ~750 lines",
  },
);

/** The median of what is actually loaded — the toolbar figure narrows with the
 *  filters rather than describing a window the table is no longer showing. */
function medianDuration(rows: readonly { durationMs: number | null }[]): number | null {
  const taken = rows
    .map((row) => row.durationMs)
    .filter((value) => value !== null)
    .sort((a, b) => a - b);
  if (taken.length === 0) return null;
  return taken[Math.floor(taken.length / 2)];
}

export const SURFACES: Surface[] = [deployments, edgeAccess, edgeEvents, firewallDecisions];
