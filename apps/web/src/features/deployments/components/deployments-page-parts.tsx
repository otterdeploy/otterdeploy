/**
 * The route's two halves, split out so the route stays a thin shell: the
 * filters + summary wired to the URL, and the body that picks loading, error,
 * empty or the list.
 */

import { ErrorState } from "@/shared/components/ui/error-state";

import type { DeploymentsSearch, StatusView } from "../data/deployments-search";
import type { DeploymentsMeta } from "../data/project-deployments";
import type { useDeploymentsPage } from "../hooks/use-deployments-page";
import type { RowActions } from "./deployment-row-menu";

import { DeploymentsFilterBar } from "./deployments-filter-bar";
import { DeploymentsEmpty, DeploymentsList, DeploymentsListLoading } from "./deployments-list";
import { DeploymentsSummary } from "./deployments-summary";

type Page = ReturnType<typeof useDeploymentsPage>;

function narrowedBeyondWindow(search: DeploymentsSearch): boolean {
  return Boolean(search.resource || search.people?.length || search.automatic || search.q);
}

/** Nothing has ever deployed here (not merely nothing in this window). */
export function isNeverDeployed(meta: DeploymentsMeta | undefined, search: DeploymentsSearch) {
  return (
    meta !== undefined &&
    meta.stats.windowTotal === 0 &&
    meta.serving.length === 0 &&
    !narrowedBeyondWindow(search)
  );
}

export function DeploymentsFilters({
  page,
  search,
  patch,
}: {
  page: Page;
  search: DeploymentsSearch;
  patch: (next: Partial<DeploymentsSearch>) => void;
}) {
  const meta = page.meta;
  return (
    <div className="flex flex-col gap-2.5">
      <DeploymentsFilterBar
        status={page.view}
        counts={page.counts}
        onStatusChange={(v: StatusView) => patch({ status: v === "all" ? undefined : v })}
        resources={page.resourceOptions}
        resource={search.resource}
        onResourceChange={(id) => patch({ resource: id })}
        people={meta?.facets.people ?? []}
        automaticCount={meta?.facets.automatic ?? 0}
        selectedPeople={search.people ?? []}
        automatic={search.automatic ?? false}
        onPeopleChange={(people, automatic) =>
          patch({
            people: people.length > 0 ? people : undefined,
            automatic: automatic || undefined,
          })
        }
        window={search.window ?? "7d"}
        onWindowChange={(v) => patch({ window: v === "7d" ? undefined : v })}
        q={search.q ?? ""}
        onQChange={(q) => patch({ q: q || undefined })}
      />
      {meta ? <DeploymentsSummary scope={page.scopeText} stats={meta.stats} /> : null}
    </div>
  );
}

/** Live now honours the date range; this counts what it hides, so the page
 *  can say so rather than quietly listing fewer resources than are live. */
function hiddenServing(page: Page, search: DeploymentsSearch): number {
  const meta = page.meta;
  if (!meta || page.view !== "live" || search.window === "all") return 0;
  if (search.people?.length || search.automatic || search.q) return 0;
  return Math.max(0, meta.serving.length - meta.stats.serving);
}

export function DeploymentsBody({
  page,
  search,
  now,
  actions,
  reset,
  patch,
  openGraph,
}: {
  page: Page;
  search: DeploymentsSearch;
  now: number;
  actions: RowActions;
  reset: () => void;
  patch: (next: Partial<DeploymentsSearch>) => void;
  openGraph: () => void;
}) {
  if (page.isError) return <ErrorState title="Couldn't load deployments" onRetry={page.refetch} />;
  if (page.isLoading) return <DeploymentsListLoading />;
  if (isNeverDeployed(page.meta, search)) {
    return <DeploymentsEmpty kind="never" onReset={reset} onOpenGraph={openGraph} />;
  }
  const hidden = hiddenServing(page, search);
  return (
    <>
      {page.rows.length === 0 ? (
        <DeploymentsEmpty kind={page.view} onReset={reset} onOpenGraph={openGraph} />
      ) : (
        <DeploymentsList
          key={`${page.scopeKey}:${page.view}`}
          rows={page.rows}
          view={page.view}
          servingByResource={page.servingByResource}
          now={now}
          heldCount={page.heldCount}
          total={page.meta?.total ?? page.heldCount}
          actions={actions}
        />
      )}
      {hidden > 0 ? (
        <p className="text-[12.5px] text-muted-foreground">
          <span className="font-mono tabular-nums">{hidden}</span> more{" "}
          {hidden === 1 ? "resource is" : "resources are"} serving a deploy that started before this
          window.{" "}
          <button
            type="button"
            className="text-primary underline-offset-2 hover:underline"
            onClick={() => patch({ window: "all" })}
          >
            Show all time
          </button>
        </p>
      ) : null}
    </>
  );
}
