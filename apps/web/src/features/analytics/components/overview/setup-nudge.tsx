/**
 * The overview's honesty header for a scope with no tracker yet. Three
 * truths, three lines: no site (offer setup), site but no first event yet
 * (waiting), several projects and none instrumented (list them). The real
 * dashboard renders below with its honest empty states — never fake zeros —
 * so the nudge is a hairline panel, not a replacement screen.
 */

import type { ReactNode } from "react";

import { useMutation, useQueries } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";
import { orpc, queryClient } from "@/shared/server/orpc";

import { useSite } from "../../hooks/use-web-analytics";

export interface NudgeProject {
  id: string;
  slug: string;
  name: string;
}

export function SetupNudge({
  project,
  projects,
  onGoSetup,
}: {
  /** The selected project, when the scope is a single project. */
  project: NudgeProject | undefined;
  /** Every project in the org, for the multi-project truth. */
  projects: readonly NudgeProject[];
  onGoSetup: (projectSlug: string) => void;
}) {
  if (project) return <SingleProjectNudge project={project} onGoSetup={onGoSetup} />;
  return <OrgNudge projects={projects} onGoSetup={onGoSetup} />;
}

function NudgePanel({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg bg-card px-4 py-3 ring-1 ring-foreground/10">
      {children}
    </div>
  );
}

function SingleProjectNudge({
  project,
  onGoSetup,
}: {
  project: NudgeProject;
  onGoSetup: (projectSlug: string) => void;
}) {
  const { t } = useTranslation();
  const site = useSite(project.id);
  const ensure = useMutation(orpc.analytics.site.ensure.mutationOptions());

  if (site.data === undefined) return null;

  if (site.data.site === null) {
    return (
      <NudgePanel>
        <p className="text-sm">{t("analytics.overview.nudgeNoSite", { project: project.name })}</p>
        <Button
          size="sm"
          disabled={ensure.isPending}
          onClick={() =>
            ensure.mutate(
              { projectId: project.id },
              {
                onSuccess: () => {
                  void queryClient.invalidateQueries({
                    queryKey: orpc.analytics.site.get.key(),
                  });
                  onGoSetup(project.slug);
                },
              },
            )
          }
        >
          {t("analytics.overview.nudgeSetUp")}
        </Button>
      </NudgePanel>
    );
  }

  if (site.data.site.firstEventAt === null) {
    return (
      <NudgePanel>
        <p className="text-sm">{t("analytics.overview.nudgeWaiting", { project: project.name })}</p>
        <Button variant="outline" size="sm" onClick={() => onGoSetup(project.slug)}>
          {t("analytics.overview.nudgeShowSnippet")}
        </Button>
      </NudgePanel>
    );
  }

  return null;
}

const ORG_NUDGE_CAP = 20;

function OrgNudge({
  projects,
  onGoSetup,
}: {
  projects: readonly NudgeProject[];
  onGoSetup: (projectSlug: string) => void;
}) {
  const { t } = useTranslation();
  const probed = projects.slice(0, ORG_NUDGE_CAP);
  const sites = useQueries({
    queries: probed.map((p) => ({
      ...orpc.analytics.site.get.queryOptions({ input: { projectId: p.id } }),
      staleTime: 60_000,
    })),
  });

  // Say nothing until every probe has answered: a premature "nothing is set
  // up" that flips a second later reads as a glitch, not honesty.
  if (probed.length === 0 || sites.some((q) => q.data === undefined)) return null;

  const withSite = probed.filter((_, i) => sites[i].data?.site !== null);
  if (withSite.length > 0) {
    const anyVerified = probed.some((_, i) => {
      const site = sites[i].data?.site;
      return site != null && site.firstEventAt !== null;
    });
    if (anyVerified) return null;
    return (
      <NudgePanel>
        <p className="text-sm">{t("analytics.overview.nudgeWaitingAny")}</p>
        <Button variant="outline" size="sm" onClick={() => onGoSetup(withSite[0].slug)}>
          {t("analytics.overview.nudgeShowSnippet")}
        </Button>
      </NudgePanel>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-card px-4 py-3 ring-1 ring-foreground/10">
      <p className="text-sm">{t("analytics.overview.nudgeNone")}</p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {probed.map((p) => (
          <li key={p.id} className="flex items-center gap-1.5 text-sm">
            <span className="text-muted-foreground">{p.name}</span>
            <button
              type="button"
              onClick={() => onGoSetup(p.slug)}
              className="text-xs font-medium underline-offset-2 hover:underline"
            >
              {t("analytics.overview.nudgeSetUp")}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
