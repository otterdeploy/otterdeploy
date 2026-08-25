/**
 * Deployment protection (auth wall) for a service resource. Finds this
 * resource's public HTTP route and reuses the same toggle + access dialog
 * the Networking page uses. Only meaningful once the service is exposed.
 * Protection gates the public Caddy HTTP route. See
 * docs/designs/deployment-protection.md.
 *
 * Reads through `proxyRoutesCollection`, NOT a bare
 * `orpc.project.proxyRoute.list` query, because that is what the toggle
 * writes to. The collection namespaces its cache key (`["proxyRoutes", …]`)
 * so a bare orpc key is a different entry entirely: reading one while writing
 * the other left the switch wired to a store nothing was updating, and it sat
 * there unmoved while the mutation succeeded on the server. Same store for the
 * read and the write is what makes the optimistic flip show up.
 */

import { eq, useLiveQuery } from "@tanstack/react-db";

import { DeploymentProtectionCell } from "@/features/projects/components/networking/deployment-protection-cell";
import { proxyRoutesCollection } from "@/features/projects/data/proxy-routes";
import { SettingsCard } from "@/features/resources/components/_shared/settings-card";

export function ServiceProtectionCard({
  resource,
}: {
  resource: { projectId: string; resourceId: string; publicEnabled: boolean };
}) {
  // Only `projectId` goes in the `where`: the OPFS persistence subset parser
  // handles simple comparisons only, so this resource's own route is picked
  // out in JS below rather than with a second clause.
  const { data: routes } = useLiveQuery(
    (q) =>
      q.from({ r: proxyRoutesCollection }).where(({ r }) => eq(r.projectId, resource.projectId)),
    [resource.projectId],
  );

  const route = (routes ?? []).find(
    (r) => r.resourceId === resource.resourceId && r.type === "http",
  );

  return (
    <SettingsCard
      title="Deployment protection"
      description="Put a login wall in front of the public URL. Only members of this organization can view the deployment after signing in."
    >
      {!resource.publicEnabled || !route ? (
        <div className="px-3 py-2.5 text-[12px] text-muted-foreground">
          Expose the service publicly first. Protection gates the public HTTP route.
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 px-3 py-2.5">
          <div className="flex flex-col">
            <span className="text-[13px] font-medium">Require login to view</span>
            <span className="text-[11px] text-muted-foreground">
              {route.protected
                ? `Members only. Share links and CI bypass via the icon.`
                : `Anyone with the URL can open ${route.domain}.`}
            </span>
          </div>
          <DeploymentProtectionCell
            route={{
              id: route.id,
              domain: route.domain,
              protected: route.protected,
              isHttp: true,
            }}
            projectId={resource.projectId}
          />
        </div>
      )}
    </SettingsCard>
  );
}
