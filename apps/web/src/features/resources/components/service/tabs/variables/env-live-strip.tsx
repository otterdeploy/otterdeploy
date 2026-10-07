/**
 * Is the change I just saved live? One line under the Variables header that
 * answers it, with the one action that makes it true.
 *
 * Before a saved variable was either "staged" (a toast sending the operator
 * off to find the pending-changes bar in the header) or written straight to
 * the database with "takes effect on the next redeploy" and no redeploy
 * button: two behaviours behind one Save, and nothing in the tab ever said
 * when the container actually had the value (only Docker could say).
 * Now both paths end in the same strip:
 *
 *   "1 variable change is saved but not applied · Apply and restart"
 *   "Restarting with the new values…"
 *   "Live since 12:03"
 *
 * The truth comes from the server: the manifest diff for staged changes, and
 * the service view's env liveness (envChangedAt vs envAppliedAt, see
 * packages/api/src/routers/service/views.ts) for saved ones. "unknown" draws
 * nothing rather than a guess.
 */
import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { RefreshIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Temporal } from "@otterdeploy/shared/temporal";
import { useMutation } from "@tanstack/react-query";
import { Result } from "better-result";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { usePendingChanges } from "@/features/projects/components/use-pending-changes";
import { useActiveEnvironment } from "@/features/shell/use-active-environment";
import { Button } from "@/shared/components/ui/button";
import { CLOCK_MINUTES, clockFormatter } from "@/shared/lib/clock";
import { orpc, queryClient } from "@/shared/server/orpc";

import { useLiveService } from "../../use-live-service";

/** What the strip says, decided from server state alone. */
export type EnvStripState =
  | { kind: "staged"; count: number }
  | { kind: "pending" }
  | { kind: "applying" }
  | { kind: "live"; sinceMs: number }
  | { kind: "none" };

/** Staged env edits for one service in a manifest diff. */
export function stagedEnvCount(
  changes: ReadonlyArray<{ kind: string; resource: string; name: string; details?: unknown }>,
  serviceName: string,
): number {
  return changes.filter((c) => {
    if (c.resource !== "env" || c.kind === "no-op") return false;
    const owner =
      typeof c.details === "object" && c.details !== null && "owner" in c.details
        ? c.details.owner
        : undefined;
    return owner === serviceName || (owner === undefined && c.name.startsWith(`${serviceName}.`));
  }).length;
}

/** The strip's state. Exported for the tests. */
export function envStripState(input: {
  stagedCount: number;
  liveness: { state: "live" | "pending" | "unknown"; appliedAt: string | null } | undefined;
  working: boolean;
}): EnvStripState {
  if (input.working) return { kind: "applying" };
  if (input.stagedCount > 0) return { kind: "staged", count: input.stagedCount };
  if (input.liveness?.state === "pending") return { kind: "pending" };
  const appliedAt = input.liveness?.state === "live" ? input.liveness.appliedAt : null;
  if (!appliedAt) return { kind: "none" };
  return Result.try(() => Temporal.Instant.from(appliedAt).epochMilliseconds)
    .map((sinceMs): EnvStripState => ({ kind: "live", sinceMs }))
    .unwrapOr({ kind: "none" });
}

const liveClock = clockFormatter(CLOCK_MINUTES);

export function EnvLiveStrip({
  projectId,
  resourceId,
  serviceName,
}: {
  projectId: ProjectId;
  resourceId: ResourceId;
  serviceName: string;
}) {
  const { t } = useTranslation();
  const service = useLiveService({ projectId, resourceId, enabled: true });
  const environment = useActiveEnvironment(projectId).slug;
  // The same diff, and the same apply, as the pending-changes bar: one way to
  // apply a staged change, wherever it is pressed.
  const { diff, applyMut } = usePendingChanges(projectId, environment);
  const refreshService = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.service.get.queryKey({ input: { projectId, resourceId } }),
    });
  // A saved (not staged) change is applied by re-rolling the service, which
  // re-resolves its env: the header's Restart, from here.
  const restartMut = useMutation({
    ...orpc.service.restart.mutationOptions(),
    onSuccess: () => void refreshService(),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to restart"),
  });

  const state = envStripState({
    stagedCount: stagedEnvCount(diff.data?.changes ?? [], serviceName),
    liveness: service?.env,
    working: applyMut.isPending || restartMut.isPending,
  });
  if (state.kind === "none") return null;

  const apply = () => {
    if (state.kind === "staged") {
      applyMut.mutate([{ resource: "service", name: serviceName }], {
        onSettled: () => void refreshService(),
      });
      return;
    }
    restartMut.mutate({ projectId, resourceId });
  };

  if (state.kind === "live") {
    return (
      <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground" role="status">
        <span aria-hidden className="size-1.5 rounded-full bg-success" />
        {t("resources.envLiveSince", { time: liveClock(state.sinceMs) })}
      </p>
    );
  }

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-warning/10 px-3 py-2 text-[12.5px] text-warning"
    >
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="size-1.5 rounded-full bg-current" />
        {state.kind === "staged"
          ? t("resources.envLiveStaged", { count: state.count })
          : state.kind === "pending"
            ? t("resources.envLivePending")
            : t("resources.envLiveApplying")}
      </span>
      {state.kind === "applying" ? null : (
        <Button size="xs" variant="outline" className="gap-1.5" onClick={apply}>
          <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} className="size-3" />
          {t("resources.envLiveApply")}
        </Button>
      )}
    </div>
  );
}
