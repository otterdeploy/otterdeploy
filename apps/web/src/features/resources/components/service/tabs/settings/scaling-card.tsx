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

import { MinusSignIcon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { SettingsCard } from "@/features/resources/components/_shared/settings-card";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { orpc, queryClient } from "@/shared/server/orpc";

import {
  buildScalingPatch,
  clusterFitMessage,
  computeClusterFit,
  CPU_LIMIT_MAX,
  CPU_LIMIT_MIN,
  desiredReplicas,
  groupRunningTasksByNode,
  initialScalingForm,
  isValidCpuLimit,
  isValidMemoryLimitMb,
  MEMORY_LIMIT_MAX_MB,
  MEMORY_LIMIT_MIN_MB,
  saveConsequence,
  type ScalingFormValues,
  type StoredScaling,
} from "./scaling-math";

interface ScalingResource {
  projectId: string;
  resourceId: string;
}

type ServiceView = Awaited<ReturnType<typeof orpc.service.get.call>>;

const rowClass = "border-b border-border/40 px-3 py-2.5 last:border-b-0";

function LimitField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  suffix,
  invalid,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  min: number;
  max: number;
  step: number;
  suffix: string;
  invalid: boolean;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          // Empty input = "no limit" — an honest unset, not zero.
          value={value ?? ""}
          min={min}
          max={max}
          step={step}
          placeholder="no limit"
          onChange={(e) => {
            const v = e.target.valueAsNumber;
            onChange(Number.isNaN(v) ? null : v);
          }}
          className="h-8 font-mono text-[12.5px]"
          aria-invalid={invalid}
        />
        <span className="shrink-0 text-[11px] text-muted-foreground">{suffix}</span>
      </div>
    </label>
  );
}

/**
 * Read-only per-node placement. Swarm: this service's running tasks grouped
 * by node hostname. Plain docker: a single implicit node, said honestly.
 */
function PlacementReadout({ service }: { service: ServiceView }) {
  const nodesQuery = useQuery({
    ...orpc.docker.nodes.list.queryOptions({ input: {} }),
    refetchInterval: 10_000,
  });
  const swarm = nodesQuery.data?.swarm ?? false;
  const swarmServiceId = service.runtime.serviceId;
  const tasksQuery = useQuery({
    ...orpc.docker.tasks.list.queryOptions({ input: {} }),
    enabled: swarm && !!swarmServiceId,
    refetchInterval: 10_000,
  });

  let body: React.ReactNode;
  if (!nodesQuery.data) {
    body = (
      <span className="text-[11px] text-muted-foreground">
        {nodesQuery.isError ? "Couldn't read cluster placement." : "Reading placement…"}
      </span>
    );
  } else if (!swarm) {
    body = (
      <NodeBox
        hostname="this server"
        running={service.runtime.status === "running" ? 1 : 0}
        note="single-node runtime"
      />
    );
  } else if (!swarmServiceId || !tasksQuery.data) {
    body = (
      <span className="text-[11px] text-muted-foreground">
        {!swarmServiceId
          ? "Not provisioned on the cluster yet."
          : tasksQuery.isError
            ? "Couldn't read this service's tasks."
            : "Reading placement…"}
      </span>
    );
  } else {
    const placements = groupRunningTasksByNode(
      tasksQuery.data,
      nodesQuery.data.nodes,
      swarmServiceId,
    );
    body =
      placements.length === 0 ? (
        <span className="text-[11px] text-muted-foreground">No running replicas.</span>
      ) : (
        placements.map((p) => (
          <NodeBox key={p.hostname} hostname={p.hostname} running={p.running} />
        ))
      );
  }

  return (
    <div className={rowClass}>
      <span className="text-[11px] text-muted-foreground">Currently running on</span>
      <div className="mt-1.5 flex flex-wrap items-stretch gap-1.5">{body}</div>
    </div>
  );
}

function NodeBox({
  hostname,
  running,
  note,
}: {
  hostname: string;
  running: number;
  note?: string;
}) {
  return (
    <div className="min-w-32 flex-1 rounded-sm border border-border bg-muted/40 p-2">
      <div className="flex items-baseline gap-2 text-[11px]">
        <span className="truncate font-mono text-muted-foreground">{hostname}</span>
        <span className="ml-auto shrink-0 font-mono text-foreground">{running}</span>
      </div>
      <div className="mt-1.5 flex min-h-2.5 flex-wrap items-center gap-1">
        {Array.from({ length: running }).map((_, i) => (
          <span key={i} className="inline-block size-2.5 rounded-xs bg-chart-2" />
        ))}
        {running === 0 && <span className="text-[10px] text-muted-foreground">—</span>}
      </div>
      {note && <div className="mt-1 text-[10px] text-muted-foreground">{note}</div>}
    </div>
  );
}

const SAVE_COPY = {
  redeploy: "Saving applies the new scale and redeploys the service (rolling update).",
  resume: "Service is paused — saving this replica count resumes it.",
  "redeploy-paused": "Service stays paused — the new limits take effect when it resumes.",
} as const;

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
        onSuccess: () =>
          toast.success(
            consequence === "resume"
              ? `Scaling saved — service resuming with ${patch.replicas} replica${patch.replicas === 1 ? "" : "s"}`
              : consequence === "redeploy-paused"
                ? "Limits saved — service stays paused"
                : "Scaling saved — service redeploying",
          ),
      },
    );
  };

  const setReplicas = (next: number) =>
    setForm((f) => ({ ...f, replicas: Math.max(1, Math.round(next)) }));

  return (
    <>
      <div className={rowClass}>
        <div className="flex items-center gap-2">
          <div className="flex flex-col">
            <span className="text-[13px] font-medium">Replicas</span>
            <span className="text-[11px] text-muted-foreground">
              {paused
                ? "Paused — this is the count Resume restores. Changing it resumes the service with the new count."
                : "Running copies of this service. Use Pause to stop it without losing config."}
            </span>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Decrease replicas"
              disabled={form.replicas <= 1 || saveMut.isPending}
              onClick={() => setReplicas(form.replicas - 1)}
            >
              <HugeiconsIcon icon={MinusSignIcon} strokeWidth={2} className="size-3" />
            </Button>
            <Input
              type="number"
              value={Number.isNaN(form.replicas) ? "" : form.replicas}
              min={1}
              onChange={(e) => setReplicas(e.target.valueAsNumber)}
              className="h-8 w-16 text-center font-mono text-[13px]"
              aria-label="Replica count"
              aria-invalid={!replicasValid}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Increase replicas"
              disabled={(plainDocker && form.replicas >= 1) || saveMut.isPending}
              onClick={() => setReplicas(form.replicas + 1)}
            >
              <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="size-3" />
            </Button>
          </div>
        </div>
        {plainDocker && (
          <div className="mt-1.5 text-[11px] text-muted-foreground">
            Plain Docker runs a single container per service — scaling out needs the Swarm runtime.
          </div>
        )}
      </div>

      <div className={rowClass}>
        <div className="grid grid-cols-2 gap-3">
          <LimitField
            label="CPU limit (per replica)"
            value={form.cpuLimit}
            onChange={(cpuLimit) => setForm((f) => ({ ...f, cpuLimit }))}
            min={CPU_LIMIT_MIN}
            max={CPU_LIMIT_MAX}
            step={0.1}
            suffix="vCPU"
            invalid={!cpuValid}
          />
          <LimitField
            label="Memory limit (per replica)"
            value={form.memoryLimitMb}
            onChange={(memoryLimitMb) => setForm((f) => ({ ...f, memoryLimitMb }))}
            min={MEMORY_LIMIT_MIN_MB}
            max={MEMORY_LIMIT_MAX_MB}
            step={64}
            suffix="MB"
            invalid={!memValid}
          />
        </div>
        <div className="mt-1.5 text-[11px] text-muted-foreground">
          {form.cpuLimit === null && form.memoryLimitMb === null
            ? "No limits set — replicas may use whatever the host has free."
            : fitLine
              ? `${fitLine} (${form.replicas} × per-replica limits vs registered servers).`
              : "Server capacity unknown — can't check fit."}
        </div>
      </div>

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
