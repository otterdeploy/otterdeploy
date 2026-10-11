/**
 * The one list: a header row naming every column, deploys grouped by day
 * ("Today Sun 11 Oct", with that day's count), and "Show older" paging over
 * what the collection holds. Live now is the same list narrowed to what each
 * resource is serving, one row per resource, newest go-live first; its rows
 * are not a timeline, so they are not grouped by day.
 *
 * Laid out as a list rather than in the shared DataGrid: rows here vary in
 * height (a failure carries its sentence and error line), expand in place to
 * the pipeline, and sit under day headings, none of which a fixed-row-height
 * spreadsheet grid does.
 */

import { useState } from "react";

import { FilterHorizontalIcon, RocketIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Temporal } from "@otterdeploy/shared/temporal";

import { Button } from "@/shared/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { CLOCK_DAY, clockFormatter } from "@/shared/lib/clock";
import { cn } from "@/shared/lib/utils";

import type { ProjectDeployment, ServingDeployment, StatusView } from "../data/deployments-search";
import type { RowActions } from "./deployment-row-menu";

import { dayTotals, groupByDay } from "../model/deployments-view";
import { DeploymentListRow, ROW_COLUMNS } from "./deployment-list-row";
import { DeploymentRowDetail } from "./deployment-row-detail";

/** Rows revealed per "Show older". */
const PAGE_ROWS = 40;

const dayDate = clockFormatter({ weekday: "short", ...CLOCK_DAY });
const viewerZone = Temporal.Now.timeZoneId();

function HeaderRow() {
  return (
    <div
      aria-hidden
      className={cn(
        "hidden border-b bg-muted/40 px-4 py-2 text-[11.5px] font-medium text-muted-foreground @4xl:grid",
        ROW_COLUMNS,
      )}
    >
      <span>Status</span>
      <span>Change</span>
      <span>Resource</span>
      <span>By</span>
      <span className="text-right">Started</span>
      <span className="text-right">Took</span>
      <span />
    </div>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="@container overflow-hidden rounded-lg bg-card ring-1 ring-foreground/10">
      {children}
    </div>
  );
}

export function DeploymentsListLoading() {
  return (
    <Frame>
      <HeaderRow />
      <div className="divide-y divide-border/70" aria-busy="true" aria-label="Loading deployments">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className={cn("grid grid-cols-2 items-center gap-3 px-4 py-3", ROW_COLUMNS)}>
            <Skeleton className="h-3.5 w-16" />
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-3.5 w-3/5" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="hidden h-3 w-14 @4xl:block" />
            <Skeleton className="hidden h-3 w-28 @4xl:block" />
            <Skeleton className="hidden h-3 w-10 justify-self-end @4xl:block" />
            <Skeleton className="hidden h-3 w-10 justify-self-end @4xl:block" />
          </div>
        ))}
      </div>
    </Frame>
  );
}

export function DeploymentsEmpty({
  kind,
  onReset,
  onOpenGraph,
}: {
  kind: "never" | StatusView;
  onReset: () => void;
  onOpenGraph: () => void;
}) {
  const copy = {
    never: [
      "No deploys yet",
      "Each deploy appears here as it starts, and the one a resource is serving is marked Live. Deploy a resource from the graph, or push to a connected repository.",
    ],
    all: ["Nothing matches these filters", "Clear a filter, or widen the date range."],
    live: [
      "Nothing live matches these filters",
      "A resource appears here when the deploy it is serving started inside the date range and matches the other filters.",
    ],
    progress: ["Nothing is deploying", "Every deploy in this window has finished."],
    failed: ["No failed deploys in this window", "Every deploy in this window shipped."],
  } as const;
  const [title, body] = copy[kind];
  return (
    <Frame>
      <Empty className="py-12">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon
              icon={kind === "never" ? RocketIcon : FilterHorizontalIcon}
              strokeWidth={2}
            />
          </EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{body}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          {kind === "never" ? (
            <Button type="button" size="sm" onClick={onOpenGraph}>
              Open the graph
            </Button>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={onReset}>
              Clear filters
            </Button>
          )}
        </EmptyContent>
      </Empty>
    </Frame>
  );
}

export function DeploymentsList({
  rows,
  view,
  servingByResource,
  now,
  heldCount,
  total,
  actions,
}: {
  /** The rows of the current view, newest first. */
  rows: ProjectDeployment[];
  view: StatusView;
  servingByResource: Map<string, ServingDeployment>;
  now: number;
  /** Rows the collection holds, and the scope's true total (it can be more). */
  heldCount: number;
  total: number;
  actions: RowActions;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [shown, setShown] = useState(PAGE_ROWS);
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderRow = (d: ProjectDeployment) => (
    <DeploymentListRow
      key={d.id}
      d={d}
      serving={servingByResource.get(d.resourceId)}
      now={now}
      expanded={open.has(d.id)}
      onToggle={() => toggle(d.id)}
      actions={actions}
      detail={<DeploymentRowDetail d={d} now={now} actions={actions} />}
    />
  );

  if (view === "live") {
    const byGoLive = rows.toSorted(
      (a, b) => Date.parse(b.completedAt ?? b.createdAt) - Date.parse(a.completedAt ?? a.createdAt),
    );
    return (
      <Frame>
        <HeaderRow />
        <ul>{byGoLive.map(renderRow)}</ul>
      </Frame>
    );
  }

  const visible = rows.slice(0, shown);
  const totals = dayTotals(rows, viewerZone);
  const groups = groupByDay(visible, Temporal.Instant.fromEpochMilliseconds(now), viewerZone);
  return (
    <Frame>
      <HeaderRow />
      {groups.map((g, i) => {
        const t = totals.get(g.key) ?? { total: g.items.length, failed: 0 };
        return (
          <section key={g.key} aria-label={g.relative ?? dayDate(g.epochMs)}>
            <h3
              className={cn(
                "flex items-baseline gap-2 px-3.5 pt-3.5 pb-1.5 text-[12.5px] @4xl:px-4",
                i > 0 && "border-t",
              )}
            >
              {g.relative ? <span className="font-semibold">{g.relative}</span> : null}
              <span className={g.relative ? "text-muted-foreground" : "font-semibold"}>
                {dayDate(g.epochMs)}
              </span>
              <span className="ml-auto text-[12px] font-normal text-muted-foreground">
                <span className="font-mono tabular-nums">{t.total}</span>{" "}
                {t.total === 1 ? "deploy" : "deploys"}
                {t.failed > 0 ? (
                  <>
                    {" · "}
                    <span className="font-mono tabular-nums">{t.failed}</span> failed
                  </>
                ) : null}
              </span>
            </h3>
            <ul>{g.items.map(renderRow)}</ul>
          </section>
        );
      })}
      {rows.length > shown || total > heldCount ? (
        <div className="flex flex-wrap items-center justify-center gap-3 border-t px-4 py-3 text-[12px] text-muted-foreground">
          {rows.length > shown ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShown((n) => n + PAGE_ROWS)}
            >
              Show{" "}
              <span className="font-mono tabular-nums">
                {Math.min(PAGE_ROWS, rows.length - shown)}
              </span>{" "}
              older
            </Button>
          ) : null}
          <span>
            Showing <span className="font-mono tabular-nums">{Math.min(shown, rows.length)}</span>{" "}
            of <span className="font-mono tabular-nums">{rows.length}</span>
            {total > heldCount ? (
              <>
                {" "}
                (the newest <span className="font-mono tabular-nums">{heldCount}</span> of{" "}
                <span className="font-mono tabular-nums">{total}</span>; narrow the date range to
                see older ones)
              </>
            ) : null}
          </span>
        </div>
      ) : null}
    </Frame>
  );
}
