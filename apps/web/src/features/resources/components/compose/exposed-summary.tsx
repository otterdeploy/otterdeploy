/**
 * Stack Settings "Exposed services" card — a READ-ONLY summary of which child
 * services are publicly reachable. Public exposure (Expose publicly / DOMAINS
 * / deployment protection) is owned exclusively by each child service's own
 * Settings tab — identical to a standalone service. This card just reflects
 * that state (service → hostname → status) and hands off to the child's own
 * panel via "Manage", so there is exactly one place that can flip a route on
 * or off. See od-80d — this replaces the old editable "Save exposures" form,
 * which wrote a second, divergent set of Caddy routes keyed to the STACK's
 * own resourceId instead of the child's.
 */
import type { ProjectSlug } from "@otterdeploy/shared/id";

import { eq, useLiveQuery } from "@tanstack/react-db";
import { useQuery } from "@tanstack/react-query";
import { Link, useLoaderData } from "@tanstack/react-router";

import { SettingsCard } from "@/features/resources/components/_shared/settings-card";
import {
  StatusBadge,
  type BaseDomainStatus,
  type DomainView,
} from "@/features/resources/components/service/tabs/settings/domains-card-parts";
import { resourceCollection } from "@/features/resources/data/resource";
import { buttonVariants } from "@/shared/components/ui/button";
import { orpc } from "@/shared/server/orpc";

/** Synthesize the minimal `DomainView` `StatusBadge` needs from a child
 *  service's own denormalized public fields — the same "generated" host the
 *  child's own Domains card would show a Live/Pending DNS chip for. Custom
 *  domains, verification, and DNS detail all still live on the child's own
 *  Domains card; this summary only needs enough to say "reachable" honestly. */
function toDomainView(publicDomain: string): DomainView {
  return {
    id: publicDomain,
    domain: publicDomain,
    source: "generated",
    isPrimary: true,
    status: "live",
    dnsState: "pointed",
    dnsCheckedAt: null,
    usesAcme: false,
    protected: false,
    ownershipVerified: true,
    verifyRecord: null,
    verifyToken: null,
    dnsTarget: null,
  };
}

export function ComposeExposedSummary({
  projectId,
  resourceId,
  orgSlug,
  projectSlug,
}: {
  projectId: string;
  resourceId: string;
  orgSlug: string;
  projectSlug: ProjectSlug;
}) {
  // Same on-demand collection the graph node + services tab read — a toggle
  // on the child's own Settings tab shows up here without a second fetch.
  const { data: projectResources } = useLiveQuery(
    (q) => q.from({ r: resourceCollection }).where(({ r }) => eq(r.projectId, projectId)),
    [projectId],
  );

  const exposed = projectResources.filter(
    (r) => r.type === "service" && r.stackId === resourceId && r.publicEnabled,
  ) as Array<{ resourceId: string; name: string; publicDomain: string | null }>;

  // Generated hostnames route under the org's base domain — read the same
  // verification signal the child's own Domains card does, so this chip never
  // disagrees with the one the operator sees after clicking Manage.
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

  return (
    <SettingsCard
      title="Exposed services"
      description="Public routes for this stack. Each service owns its own exposure — open Manage to change what's public."
    >
      {exposed.length === 0 ? (
        <div className="px-4 py-8 text-center text-[12.5px] text-muted-foreground">
          No public routes — expose a service from its own Settings.
        </div>
      ) : (
        <div className="divide-y divide-border/40">
          {exposed.map((svc) => (
            <div
              key={svc.resourceId}
              className="flex items-center justify-between gap-3 px-3 py-2.5"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-[13px] font-medium">{svc.name}</span>
                {svc.publicDomain ? (
                  <span className="truncate font-mono text-[11.5px] text-muted-foreground">
                    {svc.publicDomain}
                  </span>
                ) : (
                  <span className="text-[11.5px] text-muted-foreground">No domain yet</span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {svc.publicDomain && (
                  <StatusBadge
                    domain={toDomainView(svc.publicDomain)}
                    baseDomainStatus={baseDomainStatus}
                  />
                )}
                <Link
                  to="/$orgSlug/$projectSlug/graph/$resourceId"
                  params={{ orgSlug, projectSlug, resourceId: svc.resourceId }}
                  search={{ tab: "settings" }}
                  className={buttonVariants({ size: "xs", variant: "ghost" })}
                >
                  Manage
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </SettingsCard>
  );
}
