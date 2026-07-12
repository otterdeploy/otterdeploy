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

import { useState } from "react";

import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { SettingsCard } from "@/features/resources/components/_shared/settings-card";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Spinner } from "@/shared/components/ui/spinner";
import { RESOURCE_COLLECTION_KEY } from "@/features/resources/data/resource";
import { orpc, queryClient } from "@/shared/server/orpc";

import type { DomainView } from "./domains-card-parts";

import { DnsHint, DomainEditRow, DomainRowActions, StatusBadge } from "./domains-card-parts";

export function ServiceDomainsCard({
  resource,
}: {
  resource: { projectId: string; resourceId: string; publicEnabled: boolean };
}) {
  const input = {
    projectId: resource.projectId as never,
    resourceId: resource.resourceId as never,
  };

  const domains = useQuery(orpc.service.domains.list.queryOptions({ input }));

  const onSettled = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.service.domains.list.queryKey({ input }),
      }),
      // The primary mirrors into the resource list (panel header, graph).
      queryClient.invalidateQueries({
        queryKey: orpc.project.resource.list.queryKey({
          input: { projectId: resource.projectId as never },
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

function DomainRow({
  domain,
  input,
  onSettled,
}: {
  domain: DomainView;
  input: { projectId: never; resourceId: never };
  onSettled: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(domain.domain);

  const route = { ...input, routeId: domain.id };

  const recheck = useMutation({
    ...orpc.service.domains.recheck.mutationOptions(),
    onSuccess: (res) => {
      if (res.dnsState === "pointed")
        toast.success(`${res.domain} points here — certificate will issue`);
      else if (res.dnsState === "proxied") toast.success(`${res.domain} is proxied via Cloudflare`);
      else toast.warning(`${res.domain} isn't pointed here yet`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "DNS check failed"),
    onSettled,
  });

  const setPrimary = useMutation({
    ...orpc.service.domains.setPrimary.mutationOptions(),
    onSuccess: () => toast.success(`${domain.domain} is now the primary domain`),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to set primary"),
    onSettled,
  });

  const remove = useMutation({
    ...orpc.service.domains.remove.mutationOptions(),
    onSuccess: () => toast.success(`Removed ${domain.domain}`),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to remove domain"),
    onSettled,
  });

  const update = useMutation({
    ...orpc.service.domains.update.mutationOptions(),
    onSuccess: () => {
      setEditing(false);
      toast.success("Domain updated");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to update domain"),
    onSettled,
  });

  const busy = recheck.isPending || setPrimary.isPending || remove.isPending || update.isPending;
  // Custom hosts that aren't confirmed pointed here still need a DNS record.
  const needsDns =
    domain.source === "custom" && domain.dnsState !== "pointed" && domain.dnsState !== "proxied";

  if (editing) {
    return (
      <DomainEditRow
        value={value}
        onChange={setValue}
        onSave={() => update.mutate({ ...route, domain: value.trim().toLowerCase() })}
        saving={update.isPending}
        onCancel={() => {
          setValue(domain.domain);
          setEditing(false);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 basis-full items-center gap-2 sm:flex-1 sm:basis-auto">
          {domain.status === "live" ? (
            <a
              href={`https://${domain.domain}`}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 truncate font-mono text-[12.5px] text-foreground underline decoration-muted-foreground/50 underline-offset-4 hover:decoration-foreground"
            >
              {domain.domain}
            </a>
          ) : (
            <span className="min-w-0 truncate font-mono text-[12.5px] text-foreground">
              {domain.domain}
            </span>
          )}

          {domain.isPrimary && <Badge variant="default">Primary</Badge>}
          <StatusBadge domain={domain} />
        </div>

        <DomainRowActions
          domain={domain}
          busy={busy}
          recheckPending={recheck.isPending}
          needsDns={needsDns}
          onRecheck={() => recheck.mutate(route)}
          onSetPrimary={() => setPrimary.mutate(route)}
          onEdit={() => setEditing(true)}
          onRemove={() => remove.mutate(route)}
        />
      </div>

      {needsDns && <DnsHint domain={domain} />}
    </div>
  );
}
