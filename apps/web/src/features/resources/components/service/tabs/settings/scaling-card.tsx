/**
 * Scaling settings for a deployed service — replica stepper + per-replica
 * CPU/memory limits, persisted on the service row via `service.update`
 * (which redeploys as a rolling update). Plus two read-only truths: a
 * cluster-fit line (requested = replicas × limits vs registered server
 * capacity) and where the replicas currently run (swarm tasks by node).
 *
 * Pause interaction: the server clears the pause marker whenever a patch
 * carries an explicit `replicas` value, so moving the stepper on a paused
 * service resumes it with the new count — the copy says so before Save.
 * A limits-only save omits `replicas` and leaves the pause intact.
 */

import { useState } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { SettingsCard } from "@/features/resources/components/_shared/settings-card";
import { Button } from "@/shared/components/ui/button";
import { orpc, queryClient } from "@/shared/server/orpc";

import {
  buildScalingPatch,
  clusterFitMessage,
  computeClusterFit,
  desiredReplicas,
  initialScalingForm,
  isValidCpuLimit,
  isValidMemoryLimitMb,
  saveConsequence,
  type ScalingFormValues,
  type ScalingPatch,
  type StoredScaling,
} from "./scaling-math";
import { LimitsRow, ReplicasRow } from "./scaling-parts";
import { PlacementReadout } from "./scaling-placement";

interface ScalingResource {
  projectId: string;
  resourceId: string;
}

type ServiceView = Awaited<ReturnType<typeof orpc.service.get.call>>;

type SaveConsequence = ReturnType<typeof saveConsequence>;

const SAVE_COPY = {
  redeploy: "Saving applies the new scale and redeploys the service (rolling update).",
  resume: "Service is paused — saving this replica count resumes it.",
  "redeploy-paused": "Service stays paused — the new limits take effect when it resumes.",
} as const;

function savedToastText(consequence: SaveConsequence | null, patch: ScalingPatch): string {
  return consequence === "resume"
    ? `Scaling saved — service resuming with ${patch.replicas} replica${patch.replicas === 1 ? "" : "s"}`
    : consequence === "redeploy-paused"
      ? "Limits saved — service stays paused"
      : "Scaling saved — service redeploying";
}

function ScalingForm({ resource, service }: { resource: ScalingResource; service: ServiceView }) {
  const stored: StoredScaling = {
    replicas: service.replicas,
    pausedReplicas: service.pausedReplicas,
    cpuLimit: service.resources.cpuLimit,
    memoryLimitMb: service.resources.memoryLimitMb,
  };
  const [form, setForm] = useState<ScalingFormValues>(() => initialScalingForm(stored));
  const paused = stored.pausedReplicas !== null;

  // Plain docker runs exactly one container per service — the runtime driver
  // ignores replicas>1 — so the stepper won't offer counts it can't honor.
  const nodesQuery = useQuery(orpc.docker.nodes.list.queryOptions({ input: {} }));
  const plainDocker = nodesQuery.data ? !nodesQuery.data.swarm : false;

  const serversQuery = useQuery(orpc.server.list.queryOptions());
  const fit = computeClusterFit({
    replicas: form.replicas,
    cpuLimit: form.cpuLimit,
    memoryLimitMb: form.memoryLimitMb,
    nodes: (serversQuery.data ?? []).map((s) => ({
      cpuTotal: s.cpuTotal,
      memTotalGb: s.memTotalGb,
    })),
  });
  const fitLine = clusterFitMessage(fit);

  const saveMut = useMutation({
    ...orpc.service.update.mutationOptions(),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to save scaling"),
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.service.get.queryKey({
            input: {
              projectId: resource.projectId as never,
              resourceId: resource.resourceId as never,
            },
          }),
        }),
        queryClient.invalidateQueries({ queryKey: ["resource"] }),
      ]);
    },
  });

  const patch = buildScalingPatch(stored, form);
  const cpuValid = isValidCpuLimit(form.cpuLimit);
  const memValid = isValidMemoryLimitMb(form.memoryLimitMb);
  const replicasValid = Number.isInteger(form.replicas) && form.replicas >= 1;
  const formValid = cpuValid && memValid && replicasValid;
  const consequence = patch ? saveConsequence(stored, patch) : null;

  const save = () => {
    if (!patch || !formValid) return;
    saveMut.mutate(
      {
        projectId: resource.projectId as never,
        resourceId: resource.resourceId as never,
        ...(patch.replicas !== undefined ? { replicas: patch.replicas } : {}),
        ...(patch.resources ? { resources: patch.resources } : {}),
      },
      {
        onSuccess: () => toast.success(savedToastText(consequence, patch)),
      },
    );
  };

  const setReplicas = (next: number) =>
    setForm((f) => ({ ...f, replicas: Math.max(1, Math.round(next)) }));

  return (
    <>
      <ReplicasRow
        replicas={form.replicas}
        paused={paused}
        plainDocker={plainDocker}
        saving={saveMut.isPending}
        invalid={!replicasValid}
        onChange={setReplicas}
      />

      <LimitsRow
        form={form}
        cpuValid={cpuValid}
        memValid={memValid}
        fitLine={fitLine}
        onPatch={(p) => setForm((f) => ({ ...f, ...p }))}
      />

      <PlacementReadout service={service} />

      {(patch !== null || saveMut.isPending) && consequence && (
        <div className="flex items-center justify-between gap-3 px-3 py-2.5">
          <span className="text-[11px] text-muted-foreground">{SAVE_COPY[consequence]}</span>
          <Button type="button" size="sm" onClick={save} disabled={!formValid || saveMut.isPending}>
            {saveMut.isPending ? "Saving…" : "Save scaling"}
          </Button>
        </div>
      )}
    </>
  );
}

export function ServiceScalingCard({ resource }: { resource: ScalingResource }) {
  const serviceQuery = useQuery(
    orpc.service.get.queryOptions({
      input: {
        projectId: resource.projectId as never,
        resourceId: resource.resourceId as never,
      },
    }),
  );

  return (
    <SettingsCard
      title="Scaling"
      description="Replica count and per-replica resource limits. Saving redeploys the service as a rolling update."
    >
      {serviceQuery.data ? (
        // Key on the row's scaling state so a pause/resume elsewhere reseeds
        // the form instead of showing a stale stepper value.
        <ScalingForm
          key={`${resource.resourceId}:${desiredReplicas(serviceQuery.data)}:${serviceQuery.data.pausedReplicas === null ? "run" : "paused"}`}
          resource={resource}
          service={serviceQuery.data}
        />
      ) : (
        <div className="px-3 py-2.5 text-[12px] text-muted-foreground">
          {serviceQuery.isError ? "Couldn't load the service's scaling config." : "Loading…"}
        </div>
      )}
    </SettingsCard>
  );
}
