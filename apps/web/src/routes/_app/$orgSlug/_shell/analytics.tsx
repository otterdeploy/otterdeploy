/**
 * Top-level Analytics: the one traffic surface, promoted out of the project
 * shell because on a real install most edge traffic (the control-plane
 * dashboard above all) belongs to no project — a project-nested view could
 * only ever show a slice. Install admins see every host on the box; other
 * members see their org's domains; a project filter narrows either to one
 * project's domains. Window (preset or custom from/to) and filter ride the
 * URL, so a view is shareable.
 */
import { useLiveQuery } from "@tanstack/react-db";
import { createFileRoute } from "@tanstack/react-router";
import * as z from "zod";

import { ANALYTICS_RANGES } from "@/features/analytics/analytics-model";
import { AnalyticsView } from "@/features/analytics/components/analytics-view";
import { projectCollection } from "@/features/projects/data/project";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { orpc, queryClient } from "@/shared/server/orpc";

const zAnalyticsSearch = z.object({
  range: z.enum([...ANALYTICS_RANGES, "custom"]).catch("24h"),
  from: z.coerce.number().int().positive().optional().catch(undefined),
  to: z.coerce.number().int().positive().optional().catch(undefined),
  /** Project slug filter; absent = everything in scope. */
  project: z.string().optional().catch(undefined),
  /** Single-domain filter; absent = every domain in scope. */
  host: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/_app/$orgSlug/_shell/analytics")({
  staticData: { crumb: "Analytics" },
  validateSearch: zAnalyticsSearch,
  component: RouteComponent,
  // Warm the default-range overview on hover (intent-preload). Scope must
  // match what the component will ask for, or the prefetch is a wasted entry.
  loader: ({ context }) => {
    const input = context.isInstallAdmin
      ? ({ installWide: true, range: "24h" } as const)
      : ({ range: "24h" } as const);
    void queryClient
      .prefetchQuery(orpc.edgeLogs.analytics.overview.queryOptions({ input }))
      .catch(() => undefined);
  },
});

function ProjectFilter({
  value,
  allLabel,
  projects,
  onChange,
}: {
  value: string;
  allLabel: string;
  projects: ReadonlyArray<{ slug: string; name: string }>;
  onChange: (slug: string) => void;
}) {
  // Base UI's <SelectValue> resolves the selected label through `items`.
  const items = [
    { value: "all", label: allLabel },
    ...projects.map((p) => ({ value: p.slug, label: p.name })),
  ];
  return (
    <Select items={items} value={value} onValueChange={(next) => onChange(next ?? value)}>
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

function RouteComponent() {
  const { isInstallAdmin } = Route.useRouteContext();
  const { range, from, to, project, host } = Route.useSearch();
  const navigate = Route.useNavigate();

  const { data: projects } = useLiveQuery((q) => q.from({ p: projectCollection }), []);
  const selected = project ? projects.find((p) => p.slug === project) : undefined;

  const patch = (next: Partial<z.infer<typeof zAnalyticsSearch>>) =>
    void navigate({ search: (prev) => ({ ...prev, ...next }), replace: true });

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-sm font-semibold">Analytics</h1>
          <p className="text-xs text-muted-foreground">
            {selected
              ? `Requests, visitors, and response health for ${selected.name}'s public domains.`
              : isInstallAdmin
                ? "Requests, visitors, and response health for every domain on this install, dashboard included."
                : "Requests, visitors, and response health across your organization's public domains."}
          </p>
        </div>
        <ProjectFilter
          value={project ?? "all"}
          allLabel={isInstallAdmin ? "All (whole install)" : "All projects"}
          projects={projects.map((p) => ({ slug: p.slug, name: p.name }))}
          onChange={(slug) => patch({ project: slug === "all" ? undefined : slug })}
        />
      </div>
      <AnalyticsView
        projectId={selected?.id}
        installWide={isInstallAdmin && selected === undefined}
        window={{ range, from, to }}
        onWindowChange={(next) =>
          patch({ range: next.range, from: next.from, to: next.to })
        }
        hostFilter={host}
        onHostFilterChange={(next) => patch({ host: next })}
      />
    </div>
  );
}
