/**
 * Extra networks — attach this service to additional operator-created docker
 * networks (created in the Raw Docker panel). The project network is always
 * on and not listed here: Caddy routing rides it, so there is deliberately no
 * way to detach it (public exposure is the Public networking card's job via
 * `publicEnabled` — different from Dokploy, where detaching the default
 * network is the "private service" mechanism).
 *
 * The eligible-network picker reads `docker.networks.list`, which is
 * install-admin-gated — members see the attached names read-only instead of
 * a 403 (the same split the scaling card makes for `docker.nodes.list`).
 */
import { useState } from "react";

import { Delete02Icon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { toast } from "sonner";

import { SettingsCard } from "@/features/resources/components/_shared/settings-card";
import { RESOURCE_COLLECTION_KEY } from "@/features/resources/data/resource";
import { Button } from "@/shared/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { orpc, queryClient } from "@/shared/server/orpc";

interface NetworksResource {
  projectId: string;
  resourceId: string;
}

interface EligibleNetwork {
  name: string;
  driver: string;
  attachable: boolean;
  ingress: boolean;
  managed: boolean;
}

// Mirrors the server-side removal guard's builtin set.
const BUILTIN_NETWORKS = new Set(["bridge", "host", "none", "ingress", "docker_gwbridge"]);

/** Networks a service can sensibly join: attachable, operator-owned (not
 *  builtin, not a platform project network), matching the runtime's driver
 *  (swarm tasks only join overlays; plain-docker containers join bridges),
 *  and not already attached or the project network itself. */
function eligibleTargets(
  networks: EligibleNetwork[],
  opts: { swarm: boolean; projectNetwork: string; attached: string[] },
): string[] {
  const requiredDriver = opts.swarm ? "overlay" : "bridge";
  return networks
    .filter(
      (n) =>
        n.attachable &&
        !n.ingress &&
        !n.managed &&
        !BUILTIN_NETWORKS.has(n.name) &&
        n.driver === requiredDriver &&
        n.name !== opts.projectNetwork &&
        !opts.attached.includes(n.name),
    )
    .map((n) => n.name);
}

type ServiceView = Awaited<ReturnType<typeof orpc.service.get.call>>;

function ExtraNetworksForm({
  resource,
  service,
  isInstallAdmin,
}: {
  resource: NetworksResource;
  service: ServiceView;
  isInstallAdmin: boolean;
}) {
  const [staged, setStaged] = useState<string[]>(service.extraNetworks);
  const [pick, setPick] = useState<string | null>(null);

  // Both queries are install-admin-gated on the server; members never fire
  // them and get the read-only fallback below.
  const networksQuery = useQuery({
    ...orpc.docker.networks.list.queryOptions({ input: {} }),
    enabled: isInstallAdmin,
    staleTime: 10_000,
  });
  const nodesQuery = useQuery({
    ...orpc.docker.nodes.list.queryOptions({ input: {} }),
    enabled: isInstallAdmin,
    staleTime: 60_000,
  });

  const options = eligibleTargets(networksQuery.data ?? [], {
    swarm: nodesQuery.data?.swarm ?? false,
    projectNetwork: service.runtime.networkName,
    attached: staged,
  });

  const saveMut = useMutation({
    ...orpc.service.update.mutationOptions(),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to save networks"),
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.service.get.queryKey({
            input: { projectId: resource.projectId, resourceId: resource.resourceId },
          }),
        }),
        queryClient.invalidateQueries({ queryKey: RESOURCE_COLLECTION_KEY }),
      ]);
    },
  });

  const dirty =
    staged.length !== service.extraNetworks.length ||
    staged.some((n, i) => service.extraNetworks[i] !== n);

  const save = () => {
    saveMut.mutate(
      {
        projectId: resource.projectId,
        resourceId: resource.resourceId,
        extraNetworks: staged,
      },
      { onSuccess: () => toast.success("Networks saved — service redeploying to apply them") },
    );
  };

  return (
    <>
      {/* The project network, always on — shown so the list never reads as
          "this service is on no network", but with no remove affordance. */}
      <div className="flex items-center justify-between gap-3 border-b border-border/40 px-3 py-2.5">
        <span className="font-mono text-[12.5px]">{service.runtime.networkName}</span>
        <span className="text-[11px] text-muted-foreground">
          Project network — always attached
        </span>
      </div>

      {staged.map((name) => (
        <div
          key={name}
          className="flex items-center justify-between gap-3 border-b border-border/40 px-3 py-2 last:border-b-0"
        >
          <span className="font-mono text-[12.5px]">{name}</span>
          {isInstallAdmin ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Detach ${name}`}
              disabled={saveMut.isPending}
              onClick={() => setStaged(staged.filter((n) => n !== name))}
            >
              <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-3.5" />
            </Button>
          ) : null}
        </div>
      ))}

      {isInstallAdmin ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/40 bg-muted/20 px-3 py-2">
          <Select
            items={options.map((n) => ({ label: n, value: n }))}
            value={pick}
            onValueChange={(v) => {
              if (typeof v === "string") setPick(v);
            }}
          >
            <SelectTrigger
              className="h-7 min-w-44 font-mono text-xs"
              disabled={options.length === 0}
            >
              <SelectValue
                placeholder={options.length === 0 ? "No eligible networks" : "Pick a network…"}
              />
            </SelectTrigger>
            <SelectContent>
              {options.map((n) => (
                <SelectItem key={n} value={n} className="py-1.5 pl-2 font-mono text-xs">
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 text-[12px]"
            disabled={pick === null || saveMut.isPending}
            onClick={() => {
              if (pick === null) return;
              setStaged([...staged, pick]);
              setPick(null);
            }}
          >
            <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="size-3.5" />
            Attach
          </Button>
        </div>
      ) : (
        <div className="border-t border-border/40 px-3 py-2 text-[11px] text-muted-foreground">
          Attaching networks requires installation-admin access.
        </div>
      )}

      {(dirty || saveMut.isPending) && (
        <div className="flex items-center justify-between gap-3 border-t border-border/40 px-3 py-2.5">
          <span className="text-[11px] text-muted-foreground">
            Saving redeploys the service; it joins (or leaves) the networks on that deploy.
          </span>
          <Button type="button" size="sm" onClick={save} disabled={saveMut.isPending}>
            {saveMut.isPending ? "Saving…" : "Save networks"}
          </Button>
        </div>
      )}
    </>
  );
}

export function ServiceExtraNetworksCard({ resource }: { resource: NetworksResource }) {
  const isInstallAdmin = useRouteContext({ from: "/_app", select: (c) => c.isInstallAdmin });
  const serviceQuery = useQuery(
    orpc.service.get.queryOptions({
      input: { projectId: resource.projectId, resourceId: resource.resourceId },
    }),
  );

  return (
    <SettingsCard
      title="Networks"
      description="Docker networks this service is attached to. The project network is always on; extra networks (created in the Raw Docker panel) are joined on the next deploy."
    >
      {serviceQuery.data ? (
        // Key on the stored list so a save elsewhere reseeds the staged state.
        <ExtraNetworksForm
          key={`${resource.resourceId}:${serviceQuery.data.extraNetworks.join(",")}`}
          resource={resource}
          service={serviceQuery.data}
          isInstallAdmin={isInstallAdmin}
        />
      ) : (
        <div className="px-3 py-2.5 text-[12px] text-muted-foreground">
          {serviceQuery.isError ? "Couldn't load the service's networks." : "Loading…"}
        </div>
      )}
    </SettingsCard>
  );
}
