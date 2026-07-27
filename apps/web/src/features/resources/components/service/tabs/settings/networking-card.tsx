/**
 * Public Networking — the one surface that decides whether a service is
 * reachable from the internet, and on which hosts.
 *
 * Domains ARE the exposure. There is no separate "expose publicly" switch to
 * find and no confirmation modal standing between the operator and a URL:
 * "Generate domain" mints the platform host and publishes on it, "Add custom
 * domain" attaches a name of theirs, and removing the last host puts the
 * service back on the project network only. That is the shape Railway's
 * public-networking panel uses, and it is the shape people arrive expecting.
 *
 * Being direct is not the same as being quiet: a generated sslip.io host says
 * on its own row that it is temporary and self-signed, and a custom host that
 * DNS hasn't reached yet shows the exact records to publish. Backed by
 * `service.domains.*`; each host is a proxy_route, so deployment protection
 * (the Protection card) applies per domain.
 */

import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { useState } from "react";

import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useLoaderData } from "@tanstack/react-router";

import { SettingsCard } from "@/features/resources/components/_shared/settings-card";
import { Button } from "@/shared/components/ui/button";
import { Spinner } from "@/shared/components/ui/spinner";
import { orpc } from "@/shared/server/orpc";

import type { PortChoice } from "./domain-row-parts";
import type { BaseDomainStatus, DomainView } from "./domains-card-parts";

import { DomainAddForm } from "./domain-add-form";
import { DomainRow } from "./domain-row";
import { useServiceNetworking } from "./use-service-networking";

export function ServiceNetworkingCard({
  resource,
}: {
  resource: { projectId: ProjectId; resourceId: ResourceId };
}) {
  const input = {
    projectId: resource.projectId,
    resourceId: resource.resourceId,
  };

  const domains = useQuery(orpc.service.domains.list.queryOptions({ input }));
  // Ports live on the live service record, not on the panel resource — the
  // add/edit forms need them to offer a target port.
  const service = useQuery(orpc.service.get.queryOptions({ input }));
  const ports: PortChoice[] = (service.data?.ports ?? []).map((p) => ({
    containerPort: p.containerPort,
    appProtocol: p.appProtocol,
    isPrimary: p.isPrimary,
  }));

  const baseDomainStatus = useBaseDomainStatus();

  const [adding, setAdding] = useState(false);
  const { onSettled, add, generate, republish } = useServiceNetworking({
    input,
    onAdded: () => setAdding(false),
  });

  const rows = domains.data ?? [];
  const hasGenerated = rows.some((d) => d.source === "generated");
  const noHttpPort =
    service.data != null && !service.data.ports.some((p) => p.appProtocol === "http");
  const unpublished = rows.length > 0 && service.data?.publicEnabled === false;

  return (
    <SettingsCard
      title="Public networking"
      description="Reach this service over HTTPS at the hosts below. With none, it stays on the project network only."
    >
      <DomainList
        loading={domains.isLoading}
        rows={rows as DomainView[]}
        noHttpPort={noHttpPort}
        unpublished={unpublished}
        republish={republish}
        input={input}
        ports={ports}
        onSettled={onSettled}
        baseDomainStatus={baseDomainStatus}
      />

      {adding ? (
        <DomainAddForm
          input={input}
          ports={ports}
          adding={add.pending}
          onSubmit={add.run}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/40 bg-muted/20 px-3 py-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 text-[12px]"
            disabled={noHttpPort}
            onClick={() => setAdding(true)}
          >
            <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="size-3.5" />
            Custom domain
          </Button>
          {/* One generated host per service — offering it again would only
              re-publish the host that is already in the list above. */}
          {!hasGenerated && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[12px]"
              disabled={generate.pending || noHttpPort}
              onClick={generate.run}
            >
              {generate.pending ? <Spinner className="size-3.5" /> : "Generate domain"}
            </Button>
          )}
        </div>
      )}
    </SettingsCard>
  );
}

/** Generated hostnames route under the org's base domain, so a generated
 *  host is only provably reachable once that domain is verified — the
 *  workspace General page owns that, and the chip reads the same signal
 *  rather than asserting the route is live sight unseen. */
function useBaseDomainStatus(): BaseDomainStatus | undefined {
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  const orgSettings = useQuery(
    orpc.organization.settings.queryOptions({ input: { organizationId: organization.id } }),
  );
  if (!orgSettings.data) return undefined;
  if (!orgSettings.data.baseDomain) return "unset";
  return orgSettings.data.baseDomainVerifiedAt ? "verified" : "pending";
}

function DomainList({
  loading,
  rows,
  noHttpPort,
  unpublished,
  republish,
  input,
  ports,
  onSettled,
  baseDomainStatus,
}: {
  loading: boolean;
  rows: DomainView[];
  noHttpPort: boolean;
  unpublished: boolean;
  republish: { run: () => void; pending: boolean };
  input: { projectId: ProjectId; resourceId: ResourceId };
  ports: PortChoice[];
  onSettled: () => Promise<void>;
  baseDomainStatus: BaseDomainStatus | undefined;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 px-4 py-8 text-[12.5px] text-muted-foreground">
        <Spinner className="size-3.5" /> Loading domains…
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="px-4 py-7 text-center text-[12.5px] text-muted-foreground">
        {noHttpPort
          ? "This service publishes no HTTP port, so there's nothing to route to yet. Add one to its ports first."
          : "Not reachable from the internet. Generate a domain to publish it, or add one of your own."}
      </div>
    );
  }
  return (
    <div className="divide-y divide-border/40">
      {unpublished && (
        <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/30 px-3 py-2 text-[12px] text-muted-foreground">
          Public access is off — none of these hosts are being served.
          <Button
            size="xs"
            variant="secondary"
            disabled={republish.pending}
            onClick={republish.run}
          >
            {republish.pending ? <Spinner className="size-3" /> : "Publish"}
          </Button>
        </div>
      )}
      {rows.map((d) => (
        <DomainRow
          key={d.id}
          domain={d}
          input={input}
          onSettled={onSettled}
          baseDomainStatus={baseDomainStatus}
          ports={ports}
        />
      ))}
    </div>
  );
}
