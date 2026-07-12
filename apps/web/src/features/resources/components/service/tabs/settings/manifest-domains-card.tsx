/**
 * Domains card for a *pending-create* service. The live `ServiceDomainsCard`
 * talks to `service.domains.*` (resource-scoped, needs a real resourceId);
 * before the service exists there's nothing to attach a Caddy route to, so
 * here we edit the manifest entry's `domains` array instead. The reconciler
 * creates the actual routes on Apply (see manifest-apply `seedServiceDomains`),
 * and DNS/cert verification happens once the service is live — hence the
 * "verified after deploy" note rather than a recheck button.
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

interface ManifestDomain {
  domain: string;
  primary?: boolean;
}

export function ManifestDomainsCard({
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
  const domains: ManifestDomain[] =
    svc && "domains" in svc && Array.isArray(svc.domains) ? svc.domains : [];

  const stage = useStageManifestChange(projectId as ProjectId);

  // Stage a new domains array onto this service's manifest entry.
  const setDomains = (next: ManifestDomain[]) =>
    stage.mutateAsync((m) => {
      const current = m.services[serviceName];
      if (!current) return m;
      return {
        ...m,
        services: {
          ...m.services,
          [serviceName]: { ...current, domains: next },
        },
      };
    });

  const form = useForm({
    defaultValues: { domain: "" },
    onSubmit: async ({ value }) => {
      const domain = value.domain.trim().toLowerCase();
      if (!domain) return;
      if (domains.some((d) => d.domain === domain)) {
        form.reset();
        return;
      }
      // First domain becomes primary by default.
      await setDomains([...domains, { domain, primary: domains.length === 0 }]);
      form.reset();
    },
  });

  const remove = (domain: string) => {
    const next = domains.filter((d) => d.domain !== domain);
    // Keep exactly one primary if any remain.
    if (next.length > 0 && !next.some((d) => d.primary)) next[0].primary = true;
    void setDomains(next);
  };

  const makePrimary = (domain: string) =>
    void setDomains(domains.map((d) => ({ ...d, primary: d.domain === domain })));

  const busy = stage.isPending;

  return (
    <SettingsCard
      title="Domains"
      description="Public hostnames to attach when this service is created. Routes are provisioned on Deploy; DNS and certificates are verified once it's live."
    >
      <div className="flex flex-col">
        {domains.length === 0 ? (
          <div className="px-3 py-3 text-[12.5px] text-muted-foreground">
            No domains staged yet.
          </div>
        ) : (
          domains.map((d) => (
            <div
              key={d.domain}
              className="flex items-center gap-3 border-b border-border/40 px-3 py-2.5 last:border-b-0"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-foreground">
                {d.domain}
              </span>
              {d.primary ? (
                <span className="shrink-0 rounded-full bg-primary/12 px-2 py-0.5 text-[10.5px] font-medium tracking-wide text-primary uppercase">
                  Primary
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => makePrimary(d.domain)}
                  disabled={busy}
                  className="shrink-0 text-muted-foreground/70 transition-colors hover:text-foreground disabled:opacity-50"
                  aria-label={`Make ${d.domain} primary`}
                  title="Make primary"
                >
                  <HugeiconsIcon icon={StarIcon} strokeWidth={2} className="size-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => remove(d.domain)}
                disabled={busy}
                className="shrink-0 text-muted-foreground/70 transition-colors hover:text-destructive disabled:opacity-50"
                aria-label={`Remove ${d.domain}`}
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
          <form.Field name="domain">
            {(field) => (
              <Input
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="app.example.com"
                className={cn("h-8 font-mono text-[12.5px]")}
              />
            )}
          </form.Field>
          <form.Subscribe selector={(s) => s.values.domain}>
            {(domain) => (
              <Button
                type="submit"
                size="sm"
                className="h-8 shrink-0 gap-1.5 text-[12px]"
                disabled={busy || domain.trim().length === 0}
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
