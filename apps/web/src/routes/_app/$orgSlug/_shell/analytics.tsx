/**
 * Analytics: one page, six search-param views. Overview / Realtime / Events /
 * Setup read the tracker plane (`analytics.*`); Traffic mounts the edge-plane
 * view (`edgeLogs.analytics.*`) unchanged; Funnels is a placeholder until
 * Phase 3. Scope, window, filters, hero metric and compare all ride the URL,
 * so any reading is a shareable link. Install admins see the whole install
 * unless they pick a project; everyone else sees their org.
 */

import { useLiveQuery } from "@tanstack/react-db";
import { createFileRoute } from "@tanstack/react-router";
import { Temporal } from "@otterdeploy/shared/temporal";
import { Result } from "better-result";
import { useTranslation } from "react-i18next";
import * as z from "zod";

import { AnalyticsView } from "@/features/analytics/components/analytics-view";
import { EventsView } from "@/features/analytics/components/events/events-view";
import { LiveBadge } from "@/features/analytics/components/live-badge";
import { OverviewView } from "@/features/analytics/components/overview/overview-view";
import { RealtimeView } from "@/features/analytics/components/realtime/realtime-view";
import { SetupView } from "@/features/analytics/components/setup/setup-view";
import { WebRangePicker } from "@/features/analytics/components/web-range-picker";
import {
  type AnalyticsScope,
  BROWSER_TZ,
  defaultOverviewInput,
  useOverview,
} from "@/features/analytics/hooks/use-web-analytics";
import { decodeFilters, encodeFilters } from "@/features/analytics/lib/filter-codec";
import { OVERVIEW_METRICS } from "@/features/analytics/lib/overview-metrics";
import { RANGE_KEYS, toEdgeWindow } from "@/features/analytics/lib/range";
import { projectCollection } from "@/features/projects/data/project";
import { PageHeader } from "@/shared/components/page";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { orpc, queryClient } from "@/shared/server/orpc";

const VIEWS = ["overview", "realtime", "traffic", "events", "funnels", "setup"] as const;

const zAnalyticsSearch = z.object({
  // `.default().catch()`: optional on the way in (so `search={{ range }}` deep
  // links type-check), never undefined on the way out, garbage → the default.
  view: z.enum(VIEWS).default("overview").catch("overview"),
  /** Includes the legacy edge-plane values (24h/7d/30d/90d) so old deep
   *  links and `project-metrics-section.tsx` keep resolving. */
  range: z.enum(RANGE_KEYS).default("7d").catch("7d"),
  from: z.coerce.number().int().positive().optional().catch(undefined),
  to: z.coerce.number().int().positive().optional().catch(undefined),
  /** Project slug; absent = org (install-wide for admins). */
  project: z.string().optional().catch(undefined),
  /** Single-domain filter, Traffic view only. */
  host: z.string().optional().catch(undefined),
  /** Encoded filter list, see lib/filter-codec.ts. */
  f: z.string().optional().catch(undefined),
  metric: z.enum(OVERVIEW_METRICS).default("visitors").catch("visitors"),
  compare: z.enum(["1"]).optional().catch(undefined),
});

type AnalyticsSearch = z.infer<typeof zAnalyticsSearch>;

export const Route = createFileRoute("/_app/$orgSlug/_shell/analytics")({
  staticData: { crumb: "Analytics" },
  validateSearch: zAnalyticsSearch,
  component: AnalyticsRoute,
  // Intent-preload; the input must match the component's cold-landing ask.
  loader: ({ context }) => {
    void Result.tryPromise({
      try: () =>
        queryClient.prefetchQuery(
          orpc.analytics.overview.queryOptions({
            input: defaultOverviewInput(context.isInstallAdmin),
          }),
        ),
      catch: () => undefined,
    });
  },
});

function ScopeSelect({
  value,
  allLabel,
  projects,
  onChange,
}: {
  value: string;
  allLabel: string;
  projects: ReadonlyArray<{ slug: string; name: string }>;
  onChange: (slug: string | undefined) => void;
}) {
  const items = [
    { value: "all", label: allLabel },
    ...projects.map((p) => ({ value: p.slug, label: p.name })),
  ];
  return (
    <Select
      items={items}
      value={value}
      onValueChange={(next) => onChange(next === null || next === "all" ? undefined : next)}
    >
      <SelectTrigger className="h-8 w-44 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function AnalyticsRoute() {
  const { t } = useTranslation();
  const { isInstallAdmin } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const { data: projects } = useLiveQuery((q) => q.from({ p: projectCollection }), []);
  const projectList = projects.map((p) => ({ id: p.id, slug: p.slug, name: p.name }));
  const selected = search.project
    ? projectList.find((p) => p.slug === search.project)
    : undefined;

  const scope: AnalyticsScope = {
    projectId: selected?.id,
    installWide: isInstallAdmin && selected === undefined,
  };
  const filters = decodeFilters(search.f);
  const win = { range: search.range, from: search.from, to: search.to, filters };

  const patch = (next: Partial<AnalyticsSearch>) =>
    void navigate({ search: (prev) => ({ ...prev, ...next }), replace: true });

  // Same overview query the Overview view draws from: one number for "live".
  const overview = useOverview(scope, win);

  const goSetup = (slug: string) => patch({ view: "setup", project: slug });

  return (
    <Tabs
      value={search.view}
      onValueChange={(v) => patch({ view: zAnalyticsSearch.shape.view.parse(v) })}
      className="flex min-w-0 flex-1 flex-col gap-0"
    >
      <div className="border-b px-4 pt-4 pb-0 sm:px-6 sm:pt-6">
        <PageHeader
          title={
            <span className="inline-flex items-center gap-3">
              {t("analytics.title")}
              <LiveBadge live={overview.data?.liveVisitors ?? null} />
            </span>
          }
          description={
            selected
              ? t("analytics.descriptionProject", { project: selected.name })
              : isInstallAdmin
                ? t("analytics.descriptionInstall")
                : t("analytics.descriptionOrg")
          }
          actions={
            <>
              <ScopeSelect
                value={selected?.slug ?? "all"}
                allLabel={isInstallAdmin ? t("analytics.scopeInstall") : t("analytics.scopeOrg")}
                projects={projectList}
                onChange={(slug) => patch({ project: slug })}
              />
              <WebRangePicker
                value={{ range: search.range, from: search.from, to: search.to }}
                compare={search.compare === "1"}
                onChange={(next) => patch({ range: next.range, from: next.from, to: next.to })}
                onCompareChange={(on) => patch({ compare: on ? "1" : undefined })}
              />
            </>
          }
        />
        <TabsList variant="line" className="mt-4 -mb-px">
          {VIEWS.map((view) => (
            <TabsTrigger key={view} value={view}>
              {t(`analytics.tabs.${view}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      <TabsContent value="overview" className="flex min-w-0 flex-1 flex-col p-4 sm:p-6">
        <OverviewView
          scope={scope}
          win={win}
          project={selected}
          projects={projectList}
          metric={search.metric}
          onMetricChange={(metric) => patch({ metric })}
          onFiltersChange={(next) => patch({ f: encodeFilters(next) })}
          onGoSetup={goSetup}
          onShowRealtime={() => patch({ view: "realtime" })}
          onShowEvents={() => patch({ view: "events" })}
        />
      </TabsContent>

      <TabsContent value="realtime" className="flex min-w-0 flex-1 flex-col p-4 sm:p-6">
        <RealtimeView scope={scope} />
      </TabsContent>

      <TabsContent value="traffic" className="flex min-w-0 flex-1 flex-col p-4 sm:p-6">
        <AnalyticsView
          projectId={selected?.id}
          installWide={scope.installWide}
          window={toEdgeWindow(
            search.range,
            search.from,
            search.to,
            BROWSER_TZ,
            Temporal.Now.instant().epochMilliseconds,
          )}
          onWindowChange={(next) => patch({ range: next.range, from: next.from, to: next.to })}
          hostFilter={search.host}
          onHostFilterChange={(next) => patch({ host: next })}
        />
      </TabsContent>

      <TabsContent value="events" className="flex min-w-0 flex-1 flex-col p-4 sm:p-6">
        <EventsView scope={scope} win={win} />
      </TabsContent>

      <TabsContent value="funnels" className="flex min-w-0 flex-1 flex-col p-4 sm:p-6">
        <Empty className="rounded-md border border-dashed bg-muted/20 py-12">
          <EmptyHeader>
            <EmptyTitle>{t("analytics.funnels.comingSoon")}</EmptyTitle>
            <EmptyDescription>{t("analytics.funnels.description")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </TabsContent>

      <TabsContent value="setup" className="flex min-w-0 flex-1 flex-col p-4 sm:p-6">
        <SetupView project={selected} projects={projectList} onPickProject={goSetup} />
      </TabsContent>
    </Tabs>
  );
}
