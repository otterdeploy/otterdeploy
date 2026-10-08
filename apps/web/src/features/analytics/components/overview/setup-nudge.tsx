/**
 * Whether the scope has anything to show yet, and what to say when it does not.
 *
 * Three truths: no site in scope (offer setup), a site but no first event yet
 * (waiting), or data. The first two used to sit in a one-line panel above the
 * full dashboard, so the page led with five zero tiles, an empty chart and six
 * "No data" cards under a sentence that explained all of it. Neither state can
 * have data — nothing is collected before a site exists, and nothing has
 * arrived before its first event — so the overview now leads with the one
 * thing to do instead (see `AnalyticsSetupState`), and the dashboard appears
 * once there is something on it.
 */

import { Analytics01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQueries } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import { orpc, queryClient } from "@/shared/server/orpc";

export interface NudgeProject {
  id: string;
  slug: string;
  name: string;
}

/** What one project's site probe answered. */
export interface SiteAnswer {
  site: { firstEventAt: unknown } | null;
}

export type SetupState =
  /** A probe has not answered: say nothing yet. */
  | { kind: "pending" }
  /** No project in scope has a site: nothing can have been collected. */
  | { kind: "unset"; projects: readonly NudgeProject[] }
  /** Sites exist, none has received an event. */
  | { kind: "waiting"; project: NudgeProject }
  /** At least one site has data: show the dashboard. */
  | { kind: "live" };

/**
 * The state of a scope from its projects' site probes, index-aligned.
 *
 * Pending until EVERY probe has answered: a premature "nothing is set up"
 * that flips to the dashboard a second later reads as a glitch, not honesty.
 */
export function setupStateOf(
  projects: readonly NudgeProject[],
  answers: readonly (SiteAnswer | undefined)[],
): SetupState {
  if (projects.length === 0) return { kind: "live" };
  if (answers.length < projects.length || answers.some((answer) => answer === undefined)) {
    return { kind: "pending" };
  }
  const withSite = projects.filter((_, i) => answers[i]?.site != null);
  if (withSite.length === 0) return { kind: "unset", projects };
  const anyEvent = answers.some((answer) => {
    const site = answer?.site;
    return site != null && site.firstEventAt != null;
  });
  if (anyEvent) return { kind: "live" };
  return { kind: "waiting", project: withSite[0] };
}

/** Projects probed on an install-wide scope. Past this the page is not
 *  "nothing is set up" anyway: some project almost certainly is. */
const PROBE_CAP = 20;
/** While a site waits for its first event, re-ask this often, so the
 *  dashboard replaces the waiting state without a reload. */
const WAITING_POLL_MS = 10_000;

/** How long a site probe's answer is trusted before it is asked again. */
const SITE_STALE_MS = 60_000;

/** Re-ask while a site waits for its first event; stop once it has one (or
 *  there is no site to wait on). */
export function siteRefetchInterval(answer: SiteAnswer | undefined): number | false {
  const site = answer?.site;
  return site && site.firstEventAt == null ? WAITING_POLL_MS : false;
}

/** One project's site probe, as the setup state asks it. */
export function siteProbe(projectId: string) {
  return {
    ...orpc.analytics.site.get.queryOptions({ input: { projectId } }),
    staleTime: SITE_STALE_MS,
    refetchInterval: (query: { state: { data?: SiteAnswer } }) =>
      siteRefetchInterval(query.state.data),
  };
}

export function useAnalyticsSetup(
  project: NudgeProject | undefined,
  projects: readonly NudgeProject[],
): SetupState {
  const probed = project ? [project] : projects.slice(0, PROBE_CAP);
  const sites = useQueries({ queries: probed.map((p) => siteProbe(p.id)) });
  return setupStateOf(
    probed,
    sites.map((q) => q.data),
  );
}

/**
 * The overview's lead when there is nothing to chart yet. One focused panel:
 * what is missing, why the page is empty, and the one action that fixes it.
 */
export function AnalyticsSetupState({
  state,
  onGoSetup,
}: {
  state: Extract<SetupState, { kind: "unset" } | { kind: "waiting" }>;
  onGoSetup: (projectSlug: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Empty className="rounded-lg bg-card py-14 ring-1 ring-foreground/10">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon icon={Analytics01Icon} strokeWidth={1.5} />
        </EmptyMedia>
        <EmptyTitle>
          {state.kind === "unset"
            ? t("analytics.overview.setupTitle")
            : t("analytics.overview.waitingTitle")}
        </EmptyTitle>
        <EmptyDescription>
          {state.kind === "unset"
            ? t("analytics.overview.setupBody")
            : t("analytics.overview.waitingBody", { project: state.project.name })}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {state.kind === "waiting" ? (
          <Button variant="outline" size="sm" onClick={() => onGoSetup(state.project.slug)}>
            {t("analytics.overview.nudgeShowSnippet")}
          </Button>
        ) : state.projects.length === 1 ? (
          <SetUpButton project={state.projects[0]} onGoSetup={onGoSetup} />
        ) : (
          <ul className="flex w-full flex-col divide-y divide-foreground/10 rounded-lg text-left ring-1 ring-foreground/10">
            {state.projects.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="truncate text-sm">{p.name}</span>
                <SetUpButton project={p} onGoSetup={onGoSetup} variant="outline" />
              </li>
            ))}
          </ul>
        )}
      </EmptyContent>
    </Empty>
  );
}

/** Creates the project's site, then opens Setup on its snippet. */
function SetUpButton({
  project,
  onGoSetup,
  variant = "default",
}: {
  project: NudgeProject;
  onGoSetup: (projectSlug: string) => void;
  variant?: "default" | "outline";
}) {
  const { t } = useTranslation();
  const ensure = useMutation(orpc.analytics.site.ensure.mutationOptions());
  return (
    <Button
      size="sm"
      variant={variant}
      disabled={ensure.isPending}
      aria-label={t("analytics.overview.setUpProject", { project: project.name })}
      onClick={() =>
        ensure.mutate(
          { projectId: project.id },
          {
            onSuccess: () => {
              void queryClient.invalidateQueries({ queryKey: orpc.analytics.site.get.key() });
              onGoSetup(project.slug);
            },
          },
        )
      }
    >
      {t("analytics.overview.nudgeSetUp")}
    </Button>
  );
}
