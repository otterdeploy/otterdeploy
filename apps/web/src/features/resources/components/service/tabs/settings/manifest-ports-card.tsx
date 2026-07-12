/**
 * Ports card for a *pending-create* service. Ports are otherwise only settable
 * in the create wizard — once a service is staged there's no live "service
 * ports" endpoint to edit (the runtime cards need a real resource). So here we
 * edit the manifest entry's `ports` array directly; the reconciler applies them
 * on Deploy (manifest-apply-services). A port marked `http` + primary is what
 * lets a staged domain actually expose a public URL on Apply.
 */

import type { ProjectId } from "@otterdeploy/shared/id";

import { Delete02Icon, PlusSignIcon, StarIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";

import { useStageManifestChange } from "@/features/projects/hooks/use-manifest-stage";
import { SettingsCard } from "@/features/resources/components/_shared/settings-card";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

// Mirrors the manifest `portSchema` (packages/api/src/stack/manifest/schema.ts).
interface ManifestPort {
  container: number;
  protocol?: "tcp" | "udp";
  appProtocol?: "http" | "tcp";
  primary?: boolean;
  name?: string;
}

export function ManifestPortsCard({
  projectId,
  serviceName,
}: {
  projectId: string;
  serviceName: string;
}) {
  const manifest = useQuery(
    orpc.project.manifest.get.queryOptions({ input: { id: projectId as ProjectId } }),
  );
  const svc = manifest.data?.manifest?.services?.[serviceName];
  const ports: ManifestPort[] =
    svc && "ports" in svc && Array.isArray(svc.ports) ? (svc.ports as ManifestPort[]) : [];

  const stage = useStageManifestChange(projectId as ProjectId);

  // Stage a new ports array onto this service's manifest entry.
  const setPorts = (next: ManifestPort[]) =>
    stage.mutateAsync((m) => {
      const current = m.services[serviceName];
      if (!current) return m;
      return {
        ...m,
        services: { ...m.services, [serviceName]: { ...current, ports: next } },
      };
    });

  const form = useForm({
    defaultValues: { port: "" },
    onSubmit: async ({ value }) => {
      const container = Number(value.port.trim());
      if (!Number.isInteger(container) || container <= 0 || container > 65535) return;
      if (ports.some((p) => p.container === container)) {
        form.reset();
        return;
      }
      // First port is primary + HTTP by default (the common web-service case).
      await setPorts([
        ...ports,
        { container, protocol: "tcp", appProtocol: "http", primary: ports.length === 0 },
      ]);
      form.reset();
    },
  });

  const remove = (container: number) => {
    const next = ports.filter((p) => p.container !== container);
    // Keep exactly one primary if any remain.
    if (next.length > 0 && !next.some((p) => p.primary)) next[0] = { ...next[0], primary: true };
    void setPorts(next);
  };

  const makePrimary = (container: number) =>
    void setPorts(ports.map((p) => ({ ...p, primary: p.container === container })));

  const toggleHttp = (container: number) =>
    void setPorts(
      ports.map((p) =>
        p.container === container
          ? { ...p, appProtocol: p.appProtocol === "http" ? "tcp" : "http" }
          : p,
      ),
    );

  const busy = stage.isPending;

  return (
    <SettingsCard
      title="Ports"
      description="Container ports this service listens on. A port marked HTTP + primary is what a public URL routes to when the service is created."
    >
      <div className="flex flex-col">
        {ports.length === 0 ? (
          <div className="px-3 py-3 text-[12.5px] text-muted-foreground">No ports staged yet.</div>
        ) : (
          ports.map((p) => (
            <div
              key={p.container}
              className="flex items-center gap-3 border-b border-border/40 px-3 py-2.5 last:border-b-0"
            >
              <span className="min-w-0 flex-1 font-mono text-[12.5px] text-foreground">
                :{p.container}
              </span>
              <button
                type="button"
                onClick={() => toggleHttp(p.container)}
                disabled={busy}
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium tracking-wide uppercase transition-colors disabled:opacity-50",
                  p.appProtocol === "http"
                    ? "bg-primary/12 text-primary"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
                title="Toggle HTTP / TCP"
              >
                {p.appProtocol === "http" ? "HTTP" : "TCP"}
              </button>
              {p.primary ? (
                <span className="shrink-0 rounded-full bg-primary/12 px-2 py-0.5 text-[10.5px] font-medium tracking-wide text-primary uppercase">
                  Primary
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => makePrimary(p.container)}
                  disabled={busy}
                  className="shrink-0 text-muted-foreground/70 transition-colors hover:text-foreground disabled:opacity-50"
                  aria-label={`Make :${p.container} primary`}
                  title="Make primary"
                >
                  <HugeiconsIcon icon={StarIcon} strokeWidth={2} className="size-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => remove(p.container)}
                disabled={busy}
                className="shrink-0 text-muted-foreground/70 transition-colors hover:text-destructive disabled:opacity-50"
                aria-label={`Remove :${p.container}`}
              >
                <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-3.5" />
              </button>
            </div>
          ))
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
          className="flex items-center gap-2 px-3 py-2.5"
          noValidate
        >
          <form.Field name="port">
            {(field) => (
              <Input
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value.replace(/[^0-9]/g, ""))}
                inputMode="numeric"
                placeholder="3000"
                className={cn("h-8 font-mono text-[12.5px]")}
              />
            )}
          </form.Field>
          <form.Subscribe selector={(s) => s.values.port}>
            {(port) => (
              <Button
                type="submit"
                size="sm"
                className="h-8 shrink-0 gap-1.5 text-[12px]"
                disabled={busy || port.trim().length === 0}
              >
                <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="size-3.5" />
                Add
              </Button>
            )}
          </form.Subscribe>
        </form>
      </div>
    </SettingsCard>
  );
}
