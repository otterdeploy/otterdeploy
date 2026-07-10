/**
 * HTTP health-check config for a deployed service — path / interval / timeout
 * / retries, persisted on the service row (`healthcheck*` columns) via
 * `service.update`, which redeploys so the check lands as a real Docker
 * `Healthcheck` on the container.
 *
 * Docker has no native HTTP probe, so the stored cmd is a `CMD-SHELL`
 * wget-then-curl one-liner against the service's primary port on loopback
 * (see `healthcheck-http.ts`). A service with no ports gets an honest
 * "unavailable" explanation instead of a dead form; a hand-written custom
 * cmd (via API/manifest) is shown verbatim and only replaced when the
 * operator saves the HTTP form over it.
 */

import { useState } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { SettingsCard } from "@/features/resources/components/_shared/settings-card";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Switch } from "@/shared/components/ui/switch";
import { orpc, queryClient } from "@/shared/server/orpc";

import {
  buildHttpHealthcheckCmd,
  isValidHealthcheckPath,
  normalizeHealthcheckPath,
  parseHttpHealthcheckCmd,
} from "./healthcheck-http";

interface HealthCheckResource {
  projectId: string;
  resourceId: string;
}

type ServiceView = Awaited<ReturnType<typeof orpc.service.get.call>>;

const DEFAULTS = { path: "/health", intervalS: 30, timeoutS: 5, retries: 3 };

interface FormState {
  enabled: boolean;
  path: string;
  intervalS: number;
  timeoutS: number;
  retries: number;
}

function initialForm(service: ServiceView): FormState {
  const parsed = parseHttpHealthcheckCmd(service.healthcheck?.cmd ?? null);
  return {
    enabled: !!service.healthcheck?.cmd,
    path: parsed?.path ?? DEFAULTS.path,
    intervalS: Math.round((service.healthcheck?.intervalMs ?? DEFAULTS.intervalS * 1000) / 1000),
    timeoutS: Math.round((service.healthcheck?.timeoutMs ?? DEFAULTS.timeoutS * 1000) / 1000),
    retries: service.healthcheck?.retries ?? DEFAULTS.retries,
  };
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  suffix?: string;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          value={Number.isNaN(value) ? "" : value}
          min={min}
          max={max}
          onChange={(e) => onChange(e.target.valueAsNumber)}
          className="h-8 font-mono text-[12.5px]"
          aria-invalid={Number.isNaN(value) || value < min || value > max}
        />
        {suffix && <span className="text-[11px] text-muted-foreground">{suffix}</span>}
      </div>
    </label>
  );
}

function HealthCheckForm({
  resource,
  service,
}: {
  resource: HealthCheckResource;
  service: ServiceView;
}) {
  const [form, setForm] = useState<FormState>(() => initialForm(service));

  // Probe target: the primary HTTP port, else the first declared port.
  const port = (service.ports.find((p) => p.isPrimary) ?? service.ports[0])?.containerPort ?? null;

  const existingCmd = service.healthcheck?.cmd ?? null;
  const parsedExisting = parseHttpHealthcheckCmd(existingCmd);
  const isCustomCmd = !!existingCmd && !parsedExisting;

  const saveMut = useMutation({
    ...orpc.service.update.mutationOptions(),
    onSuccess: () => toast.success("Health check saved — service redeploying"),
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed to save health check"),
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

  const normalizedPath = normalizeHealthcheckPath(form.path);
  const pathValid = isValidHealthcheckPath(normalizedPath);
  const numbersValid =
    Number.isInteger(form.intervalS) &&
    form.intervalS >= 1 &&
    form.intervalS <= 3600 &&
    Number.isInteger(form.timeoutS) &&
    form.timeoutS >= 1 &&
    form.timeoutS <= 600 &&
    Number.isInteger(form.retries) &&
    form.retries >= 0 &&
    form.retries <= 20;
  const formValid = !form.enabled || (pathValid && numbersValid && port != null);

  const baseline = initialForm(service);
  const dirty =
    form.enabled !== baseline.enabled ||
    (form.enabled &&
      (normalizedPath !== (parsedExisting?.path ?? baseline.path) ||
        form.intervalS !== baseline.intervalS ||
        form.timeoutS !== baseline.timeoutS ||
        form.retries !== baseline.retries ||
        isCustomCmd));

  const save = () => {
    if (!formValid || port == null) return;
    saveMut.mutate({
      projectId: resource.projectId as never,
      resourceId: resource.resourceId as never,
      healthcheck: form.enabled
        ? {
            cmd: buildHttpHealthcheckCmd({ path: normalizedPath, port }),
            intervalMs: form.intervalS * 1000,
            timeoutMs: form.timeoutS * 1000,
            retries: form.retries,
            startMs: service.healthcheck?.startMs ?? null,
          }
        : // Explicit nulls clear the stored check (an omitted/null healthcheck
          // object is patch-semantics "leave alone" server-side).
          { cmd: null, intervalMs: null, timeoutMs: null, retries: null, startMs: null },
    });
  };

  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-border/40 px-3 py-2.5 last:border-b-0">
        <div className="flex flex-col">
          <span className="text-[13px] font-medium">HTTP health check</span>
          <span className="text-[11px] text-muted-foreground">
            {port == null
              ? "Unavailable — this service declares no container port to probe."
              : form.enabled
                ? `Probes http://127.0.0.1:${port}${pathValid ? normalizedPath : "…"} inside the container`
                : "Off — Docker only restarts the container when the process exits"}
          </span>
        </div>
        <Switch
          checked={form.enabled}
          disabled={port == null || saveMut.isPending}
          onCheckedChange={(enabled) => setForm((f) => ({ ...f, enabled }))}
        />
      </div>

      {existingCmd && isCustomCmd && (
        <div className="border-b border-border/40 px-3 py-2.5 last:border-b-0">
          <span className="text-[11px] text-muted-foreground">
            This service has a custom health-check command (set via the API or manifest). Saving the
            HTTP form replaces it.
          </span>
          <code className="mt-1.5 block truncate rounded bg-muted/50 px-2 py-1 font-mono text-[11px]">
            {existingCmd.join(" ")}
          </code>
        </div>
      )}

      {form.enabled && port != null && (
        <div className="grid grid-cols-2 gap-3 border-b border-border/40 px-3 py-2.5 last:border-b-0 sm:grid-cols-[2fr_1fr_1fr_1fr]">
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">Path</span>
            <Input
              value={form.path}
              onChange={(e) => setForm((f) => ({ ...f, path: e.target.value }))}
              placeholder="/health"
              className="h-8 font-mono text-[12.5px]"
              aria-invalid={!pathValid}
            />
          </label>
          <NumberField
            label="Interval"
            value={form.intervalS}
            onChange={(v) => setForm((f) => ({ ...f, intervalS: v }))}
            min={1}
            max={3600}
            suffix="s"
          />
          <NumberField
            label="Timeout"
            value={form.timeoutS}
            onChange={(v) => setForm((f) => ({ ...f, timeoutS: v }))}
            min={1}
            max={600}
            suffix="s"
          />
          <NumberField
            label="Retries"
            value={form.retries}
            onChange={(v) => setForm((f) => ({ ...f, retries: v }))}
            min={0}
            max={20}
          />
        </div>
      )}

      {(dirty || saveMut.isPending) && (
        <div className="flex items-center justify-between gap-3 px-3 py-2.5">
          <span className="text-[11px] text-muted-foreground">
            Saving applies the check to the container and redeploys the service.
          </span>
          <Button type="button" size="sm" onClick={save} disabled={!formValid || saveMut.isPending}>
            {saveMut.isPending ? "Saving…" : "Save health check"}
          </Button>
        </div>
      )}
    </>
  );
}

export function ServiceHealthCheckCard({ resource }: { resource: HealthCheckResource }) {
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
      title="Health check"
      description="Runs inside the container on every interval (needs wget or curl in the image). After the retry count fails consecutively the replica is marked unhealthy — deploys wait on it and the panel surfaces it."
    >
      {serviceQuery.data ? (
        <HealthCheckForm
          key={resource.resourceId}
          resource={resource}
          service={serviceQuery.data}
        />
      ) : (
        <div className="px-3 py-2.5 text-[12px] text-muted-foreground">
          {serviceQuery.isError ? "Couldn't load the service's health-check config." : "Loading…"}
        </div>
      )}
    </SettingsCard>
  );
}
