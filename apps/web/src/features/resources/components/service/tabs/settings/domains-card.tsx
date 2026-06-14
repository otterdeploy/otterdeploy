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
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlusSignIcon } from "@hugeicons/core-free-icons";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Spinner } from "@/shared/components/ui/spinner";
import { orpc, queryClient } from "@/shared/server/orpc";

import { SettingsCard } from "@/features/resources/components/_shared/settings-card";

type DnsState = "pointed" | "proxied" | "unpointed" | "unknown";

type DomainView = {
  id: string;
  domain: string;
  source: "generated" | "custom";
  isPrimary: boolean;
  status: "live" | "disabled";
  dnsState: DnsState;
  dnsCheckedAt: string | null;
  usesAcme: boolean;
  protected: boolean;
  dnsTarget: string | null;
};

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
      queryClient.invalidateQueries({ queryKey: ["resource"] }),
    ]);
  };

  const [newDomain, setNewDomain] = useState("");
  const [adding, setAdding] = useState(false);

  const add = useMutation({
    ...orpc.service.domains.add.mutationOptions(),
    onSuccess: () => {
      setNewDomain("");
      setAdding(false);
      toast.success("Domain added — point its DNS here to issue a certificate");
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed to add domain"),
    onSettled,
  });

  const onAdd = () => {
    const domain = newDomain.trim().toLowerCase();
    if (!domain) return;
    add.mutate({ ...input, domain });
  };

  const cancelAdd = () => {
    setNewDomain("");
    setAdding(false);
  };

  return (
    <SettingsCard
      title="Domains"
      description="Every host this service answers on. Add your own — point its DNS at the platform, then verify to take it live."
    >
      {!resource.publicEnabled ? (
        <div className="px-4 py-8 text-center text-[12.5px] text-muted-foreground">
          Expose the service publicly first — domains route the public HTTP
          traffic.
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
              <div className="flex items-center gap-2">
                <Input
                  autoFocus
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onAdd();
                    if (e.key === "Escape") cancelAdd();
                  }}
                  placeholder="app.example.com"
                  className="h-7 min-w-0 flex-1 font-mono text-[12.5px]"
                  spellCheck={false}
                  autoCapitalize="off"
                />
                <Button
                  size="sm"
                  className="h-7"
                  onClick={onAdd}
                  disabled={add.isPending || newDomain.trim().length === 0}
                >
                  {add.isPending ? <Spinner className="size-3.5" /> : "Add"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7"
                  onClick={cancelAdd}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 text-[12px]"
                onClick={() => setAdding(true)}
              >
                <HugeiconsIcon
                  icon={PlusSignIcon}
                  strokeWidth={2}
                  className="size-3.5"
                />
                Add domain
              </Button>
            )}
          </div>
        </>
      )}
    </SettingsCard>
  );
}

/** Connection chip. Generated hosts are always reachable (ours), so they
 *  just read Live/Disabled. Custom hosts surface their DNS reachability:
 *  pointed → cert issues here, proxied → Cloudflare serves TLS, unpointed →
 *  needs the A record below. */
function StatusBadge({ domain }: { domain: DomainView }) {
  if (domain.status === "disabled") {
    return <Badge variant="outline">Disabled</Badge>;
  }
  if (domain.source === "generated") {
    return <Badge variant="outline">Live</Badge>;
  }
  switch (domain.dnsState) {
    case "pointed":
      return <Badge variant="outline">{domain.usesAcme ? "Connected" : "Live"}</Badge>;
    case "proxied":
      return <Badge variant="secondary">Cloudflare</Badge>;
    case "unpointed":
      return <Badge variant="destructive">DNS not pointed</Badge>;
    default:
      return <Badge variant="secondary">Checking…</Badge>;
  }
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
      else if (res.dnsState === "proxied")
        toast.success(`${res.domain} is proxied via Cloudflare`);
      else toast.warning(`${res.domain} isn't pointed here yet`);
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "DNS check failed"),
    onSettled,
  });

  const setPrimary = useMutation({
    ...orpc.service.domains.setPrimary.mutationOptions(),
    onSuccess: () => toast.success(`${domain.domain} is now the primary domain`),
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed to set primary"),
    onSettled,
  });

  const remove = useMutation({
    ...orpc.service.domains.remove.mutationOptions(),
    onSuccess: () => toast.success(`Removed ${domain.domain}`),
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed to remove domain"),
    onSettled,
  });

  const update = useMutation({
    ...orpc.service.domains.update.mutationOptions(),
    onSuccess: () => {
      setEditing(false);
      toast.success("Domain updated");
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed to update domain"),
    onSettled,
  });

  const busy =
    recheck.isPending || setPrimary.isPending || remove.isPending || update.isPending;
  // Custom hosts that aren't confirmed pointed here still need a DNS record.
  const needsDns =
    domain.source === "custom" &&
    domain.dnsState !== "pointed" &&
    domain.dnsState !== "proxied";

  if (editing) {
    return (
      <div className="flex items-center gap-2 px-3 py-2.5">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-7 min-w-0 flex-1 font-mono text-[12.5px]"
          spellCheck={false}
          autoCapitalize="off"
        />
        <Button
          size="sm"
          onClick={() => update.mutate({ ...route, domain: value.trim().toLowerCase() })}
          disabled={update.isPending || value.trim().length === 0}
        >
          {update.isPending ? <Spinner className="size-3.5" /> : "Save"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setValue(domain.domain);
            setEditing(false);
          }}
        >
          Cancel
        </Button>
      </div>
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

        <div className="flex shrink-0 flex-wrap items-center gap-1">
          {domain.source === "custom" && (
            <Button
              size="xs"
              variant={needsDns ? "secondary" : "ghost"}
              onClick={() => recheck.mutate(route)}
              disabled={busy}
            >
              {recheck.isPending ? <Spinner className="size-3" /> : "Recheck DNS"}
            </Button>
          )}
          {!domain.isPrimary && domain.status === "live" && (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setPrimary.mutate(route)}
              disabled={busy}
            >
              Set primary
            </Button>
          )}
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setEditing(true)}
            disabled={busy}
          >
            Edit
          </Button>
          <Button
            size="xs"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => remove.mutate(route)}
            disabled={busy}
          >
            Remove
          </Button>
        </div>
      </div>

      {needsDns && <DnsHint domain={domain} />}
    </div>
  );
}

/** The DNS record to publish so a custom host points at us. Once it
 *  resolves here, the certificate issues automatically — no extra step. */
function DnsHint({ domain }: { domain: DomainView }) {
  return (
    <div className="rounded-md border border-dashed border-border/60 bg-muted/30 px-3 py-2 text-[11.5px]">
      <p className="mb-2 text-muted-foreground">
        {domain.dnsTarget
          ? "Add this DNS record at your provider, then Recheck. The certificate issues automatically once it resolves here."
          : "Point this domain at your server, then Recheck. The certificate issues automatically once it resolves here."}
      </p>
      {domain.dnsTarget && (
        <div className="flex flex-col gap-2 font-mono">
          <DnsRecord type="A" name={domain.domain} value={domain.dnsTarget} />
        </div>
      )}
    </div>
  );
}

/** A single DNS record line. Type + name share a row that wraps, and the
 *  value sits below so long record names and tokens both flow full-width
 *  instead of collapsing into a thin, character-wrapped column. */
function DnsRecord({
  type,
  name,
  value,
}: {
  type: string;
  name: string;
  value: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex min-w-0 items-baseline gap-2 text-muted-foreground">
        <span className="shrink-0 rounded bg-muted px-1 py-px text-[10px] font-medium uppercase tracking-wide">
          {type}
        </span>
        <span className="min-w-0 break-all">{name}</span>
      </div>
      <span className="break-all pl-1 text-foreground">{value}</span>
    </div>
  );
}
