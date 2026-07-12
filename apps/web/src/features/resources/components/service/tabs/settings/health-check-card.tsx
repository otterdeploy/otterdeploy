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

import { useForm, useStore } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { SettingsCard } from "@/features/resources/components/_shared/settings-card";
import { Button } from "@/shared/components/ui/button";
import { Switch } from "@/shared/components/ui/switch";
import { RESOURCE_COLLECTION_KEY } from "@/features/resources/data/resource";
import { orpc, queryClient } from "@/shared/server/orpc";

import { FieldsRow } from "./health-check-fields";
import {
  buildHealthcheckPatch,
  healthcheckNumbersValid,
  initialHealthcheckForm,
  isHealthcheckDirty,
  probePort,
  type HealthCheckFormState,
} from "./health-check-form";
import {
  isValidHealthcheckPath,
  normalizeHealthcheckPath,
  parseHttpHealthcheckCmd,
} from "./healthcheck-http";

interface HealthCheckResource {
  projectId: string;
  resourceId: string;
}

type ServiceView = Awaited<ReturnType<typeof orpc.service.get.call>>;

/** Title + enable switch, with an honest sub-line for each state. */
function ToggleRow({
  port,
  form,
  pathValid,
  normalizedPath,
  saving,
  onToggle,
}: {
  port: number | null;
  form: HealthCheckFormState;
  pathValid: boolean;
  normalizedPath: string;
  saving: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  return (
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
      <Switch checked={form.enabled} disabled={port == null || saving} onCheckedChange={onToggle} />
    </div>
  );
}

/** Warning shown when the stored cmd isn't our generated HTTP template. */
function CustomCmdNotice({ cmd }: { cmd: string[] }) {
  return (
    <div className="border-b border-border/40 px-3 py-2.5 last:border-b-0">
      <span className="text-[11px] text-muted-foreground">
        This service has a custom health-check command (set via the API or manifest). Saving the
        HTTP form replaces it.
      </span>
      <code className="mt-1.5 block truncate rounded bg-muted/50 px-2 py-1 font-mono text-[11px]">
        {cmd.join(" ")}
      </code>
    </div>
  );
}

function HealthCheckForm({
  resource,
  service,
}: {
  resource: HealthCheckResource;
  service: ServiceView;
}) {
  const hcForm = useForm({ defaultValues: initialHealthcheckForm(service.healthcheck) });
  const form = useStore(hcForm.store, (s) => s.values);
  const onPatch = (patch: Partial<HealthCheckFormState>) => {
    if (patch.enabled !== undefined) hcForm.setFieldValue("enabled", patch.enabled);
    if (patch.path !== undefined) hcForm.setFieldValue("path", patch.path);
    if (patch.intervalS !== undefined) hcForm.setFieldValue("intervalS", patch.intervalS);
    if (patch.timeoutS !== undefined) hcForm.setFieldValue("timeoutS", patch.timeoutS);
    if (patch.retries !== undefined) hcForm.setFieldValue("retries", patch.retries);
  };

  const port = probePort(service.ports);
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
        queryClient.invalidateQueries({ queryKey: RESOURCE_COLLECTION_KEY }),
      ]);
    },
  });

  const normalizedPath = normalizeHealthcheckPath(form.path);
  const pathValid = isValidHealthcheckPath(normalizedPath);
  const numbersValid = healthcheckNumbersValid(form);
  const formValid = !form.enabled || (pathValid && numbersValid && port != null);

  const baseline = initialHealthcheckForm(service.healthcheck);
  const dirty = isHealthcheckDirty({ form, baseline, normalizedPath, parsedExisting, isCustomCmd });

  const save = () => {
    if (!formValid || port == null) return;
    saveMut.mutate({
      projectId: resource.projectId as never,
      resourceId: resource.resourceId as never,
      healthcheck: buildHealthcheckPatch({
        form,
        normalizedPath,
        port,
        existingStartMs: service.healthcheck?.startMs,
      }),
    });
  };

  return (
    <>
      <ToggleRow
        port={port}
        form={form}
        pathValid={pathValid}
        normalizedPath={normalizedPath}
        saving={saveMut.isPending}
        onToggle={(enabled) => onPatch({ enabled })}
      />

      {existingCmd && isCustomCmd && <CustomCmdNotice cmd={existingCmd} />}

      {form.enabled && port != null && (
        <FieldsRow form={form} pathValid={pathValid} onPatch={onPatch} />
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
