/**
 * Custom-domain management for a service. Lists every host the service
 * publishes on (the generated one plus any operator-added customs), and
 * lets the operator add, edit, verify, promote, and remove them.
 *
 * Custom hosts are added "pending": the card shows the exact DNS records to
 * publish, and a Verify action runs the TXT-ownership check before the host
 * goes live (mirrors org/project custom-domain verification). Backed by
 * `service.domains.*`; each host is a proxy_route, so deployment protection
 * (the Protection card) applies per domain.
 */

import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { useState } from "react";

import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLoaderData } from "@tanstack/react-router";
import { toast } from "sonner";

import { SettingsCard } from "@/features/resources/components/_shared/settings-card";
import { RESOURCE_COLLECTION_KEY } from "@/features/resources/data/resource";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Spinner } from "@/shared/components/ui/spinner";
import { orpc, queryClient } from "@/shared/server/orpc";

import type { BaseDomainStatus, DomainView } from "./domains-card-parts";

import { DomainRow } from "./domain-row";

export function ServiceDomainsCard({
  resource,
}: {
  resource: { projectId: ProjectId; resourceId: ResourceId; publicEnabled: boolean };
}) {
  const input = {
    projectId: resource.projectId,
    resourceId: resource.resourceId,
  };

  const domains = useQuery(orpc.service.domains.list.queryOptions({ input }));

  // Generated hostnames route under the org's base domain — the workspace
  // General page owns verification of that domain, so read the same signal
  // here rather than asserting the route is live sight unseen.
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  const orgSettings = useQuery(
    orpc.organization.settings.queryOptions({ input: { organizationId: organization.id } }),
  );
  const baseDomainStatus: BaseDomainStatus | undefined = orgSettings.data
    ? !orgSettings.data.baseDomain
      ? "unset"
      : orgSettings.data.baseDomainVerifiedAt
        ? "verified"
        : "pending"
    : undefined;

  const onSettled = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.service.domains.list.queryKey({ input }),
      }),
      // The primary mirrors into the resource list (panel header, graph).
      queryClient.invalidateQueries({
        queryKey: orpc.project.resource.list.queryKey({
          input: { projectId: resource.projectId },
        }),
      }),
      queryClient.invalidateQueries({ queryKey: RESOURCE_COLLECTION_KEY }),
    ]);
  };

  const [adding, setAdding] = useState(false);

  const add = useMutation({
    ...orpc.service.domains.add.mutationOptions(),
    onSuccess: () => {
      form.reset();
      setAdding(false);
      toast.success("Domain added — point its DNS here to issue a certificate");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to add domain"),
    onSettled,
  });

  const form = useForm({
    defaultValues: { domain: "" },
    onSubmit: ({ value }) => {
      const domain = value.domain.trim().toLowerCase();
      if (!domain) return;
      add.mutate({ ...input, domain });
    },
  });

  const cancelAdd = () => {
    form.reset();
    setAdding(false);
  };

  return (
    <SettingsCard
      title="Domains"
      description="Every host this service answers on. Add your own — point its DNS at the platform, then verify to take it live."
    >
      {!resource.publicEnabled ? (
        <div className="px-4 py-8 text-center text-[12.5px] text-muted-foreground">
          Expose the service publicly first — domains route the public HTTP traffic.
        </div>
      ) : (
        <>
          {domains.isLoading ? (
            <div className="flex items-center justify-center gap-2 px-4 py-8 text-[12.5px] text-muted-foreground">
              <Spinner className="size-3.5" /> Loading domains…
            </div>
          ) : (domains.data ?? []).length === 0 ? (
            <div className="px-4 py-8 text-center text-[12.5px] text-muted-foreground">
              No domains yet. Add one to route public traffic.
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {(domains.data ?? []).map((d) => (
                <DomainRow
                  key={d.id}
                  domain={d as DomainView}
                  input={input}
                  onSettled={onSettled}
                  baseDomainStatus={baseDomainStatus}
                />
              ))}
            </div>
          )}

          <div className="border-t border-border/40 bg-muted/20 px-3 py-2">
            {adding ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void form.handleSubmit();
                }}
                className="flex items-center gap-2"
                noValidate
              >
                <form.Field name="domain">
                  {(field) => (
                    <Input
                      autoFocus
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") cancelAdd();
                      }}
                      placeholder="app.example.com"
                      className="h-7 min-w-0 flex-1 font-mono text-[12.5px]"
                      spellCheck={false}
                      autoCapitalize="off"
                    />
                  )}
                </form.Field>
                <form.Subscribe selector={(s) => s.values.domain}>
                  {(domain) => (
                    <Button
                      type="submit"
                      size="sm"
                      className="h-7"
                      disabled={add.isPending || domain.trim().length === 0}
                    >
                      {add.isPending ? <Spinner className="size-3.5" /> : "Add"}
                    </Button>
                  )}
                </form.Subscribe>
                <Button size="sm" variant="ghost" className="h-7" type="button" onClick={cancelAdd}>
                  Cancel
                </Button>
              </form>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 text-[12px]"
                onClick={() => setAdding(true)}
              >
                <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="size-3.5" />
                Add domain
              </Button>
            )}
          </div>
        </>
      )}
    </SettingsCard>
  );
}
