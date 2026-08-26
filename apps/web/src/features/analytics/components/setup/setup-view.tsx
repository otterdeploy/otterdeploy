/**
 * The Setup view: one project's tracker — snippet, verification, hosts,
 * privacy, health counters, key rotation. The site row is created lazily the
 * first time this view opens for a project (site.ensure), so "set up" is
 * literally opening this page and pasting one line.
 */

import { useEffect } from "react";

import { Alert02Icon, CodeIcon, Key01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { JoinCommandBlock } from "@/features/servers/components/join-command-block";
import { SettingsRow, SettingsSection } from "@/shared/components/settings-section";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/shared/components/ui/alert-dialog";
import { Button } from "@/shared/components/ui/button";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { CLOCK_STAMP, clockFormatter } from "@/shared/lib/clock";
import { orpc, queryClient } from "@/shared/server/orpc";

import type { NudgeProject } from "../overview/setup-nudge";

import { useSite } from "../../hooks/use-web-analytics";
import { isoMs } from "../../lib/iso-ms";
import { HealthSection, TrackingApiDoc } from "./setup-health-doc";
import { HostsSection, PrivacySection } from "./setup-view-parts";

const stamp = clockFormatter(CLOCK_STAMP);

export function invalidateSite() {
  return queryClient.invalidateQueries({ queryKey: orpc.analytics.site.get.key() });
}

export function SetupView({
  project,
  projects,
  onPickProject,
}: {
  project: NudgeProject | undefined;
  projects: readonly NudgeProject[];
  onPickProject: (slug: string) => void;
}) {
  const { t } = useTranslation();
  if (project === undefined) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 rounded-lg bg-card px-4 py-4 ring-1 ring-foreground/10">
        <p className="text-sm">{t("analytics.setup.pickProject")}</p>
        <p className="text-xs text-muted-foreground">{t("analytics.setup.pickProjectBody")}</p>
        <ul className="flex flex-wrap gap-2">
          {projects.map((p) => (
            <li key={p.id}>
              <Button variant="outline" size="sm" onClick={() => onPickProject(p.slug)}>
                {p.name}
              </Button>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return <ProjectSetup project={project} />;
}

function ProjectSetup({ project }: { project: NudgeProject }) {
  const { t } = useTranslation();
  const site = useSite(project.id);
  const ensure = useMutation(orpc.analytics.site.ensure.mutationOptions());
  // Destructured: the mutation object itself is a fresh reference per render.
  const { mutate: ensureMutate, isIdle: ensureIdle } = ensure;

  // Lazily mint the site + key on first open. Guarded by isIdle so a failed
  // ensure surfaces once rather than looping.
  const needsEnsure = site.data !== undefined && site.data.site === null;
  useEffect(() => {
    if (!needsEnsure || !ensureIdle) return;
    ensureMutate(
      { projectId: project.id },
      {
        onSuccess: () => void invalidateSite(),
        onError: () => toast.error(t("analytics.setup.ensureFailed")),
      },
    );
  }, [needsEnsure, ensureIdle, ensureMutate, project.id, t]);

  const rotate = useMutation(orpc.analytics.site.rotateKey.mutationOptions());

  const data = site.data;
  if (data === undefined || data.site === null) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    );
  }

  const row = data.site;
  const verifiedMs = row.firstEventAt !== null ? isoMs(row.firstEventAt) : null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <SettingsSection
        icon={CodeIcon}
        title={t("analytics.setup.installation")}
        description={t("analytics.setup.installationDesc", { project: project.name })}
      >
        <div className="flex flex-col gap-3 px-4 py-3.5">
          {data.snippet !== null ? <JoinCommandBlock command={data.snippet} /> : null}
          <div className="flex items-center gap-2 text-xs">
            {verifiedMs !== null ? (
              <>
                <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
                <span className="text-success">
                  {t("analytics.setup.verified", { at: stamp(verifiedMs) })}
                </span>
              </>
            ) : (
              <>
                <span
                  aria-hidden="true"
                  className="size-1.5 animate-pulse rounded-full bg-warning motion-reduce:animate-none"
                />
                <span className="text-muted-foreground">{t("analytics.setup.waiting")}</span>
              </>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{t("analytics.setup.worksWith")}</p>
        </div>
        <TrackingApiDoc />
      </SettingsSection>

      <HostsSection projectId={project.id} allowedHosts={data.allowedHosts} site={row} />
      <PrivacySection projectId={project.id} site={row} />
      <HealthSection stats={data.stats} />

      <SettingsSection
        icon={Key01Icon}
        title={t("analytics.setup.danger")}
        description={t("analytics.setup.dangerDesc")}
      >
        <SettingsRow
          title={t("analytics.setup.rotateKey")}
          description={t("analytics.setup.rotateKeyDesc")}
          control={
            <AlertDialog>
              <AlertDialogTrigger render={<Button variant="destructive" size="sm" />}>
                {t("analytics.setup.rotateKey")}
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("analytics.setup.rotateConfirmTitle")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("analytics.setup.rotateConfirmBody")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    disabled={rotate.isPending}
                    onClick={() =>
                      rotate.mutate(
                        { projectId: project.id },
                        {
                          onSuccess: () => {
                            void invalidateSite();
                            toast.success(t("analytics.setup.rotated"));
                          },
                          onError: () => toast.error(t("analytics.setup.rotateFailed")),
                        },
                      )
                    }
                  >
                    {t("analytics.setup.rotateConfirm")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          }
        />
      </SettingsSection>

      {ensure.isError ? (
        <p className="flex items-center gap-2 text-xs text-destructive">
          <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="size-3.5" />
          {t("analytics.setup.ensureFailed")}
        </p>
      ) : null}
    </div>
  );
}
