/**
 * Deployment protection (auth wall) for a service resource. Finds this
 * resource's public HTTP route and reuses the same toggle + access dialog
 * the Networking page uses. Only meaningful once the service is exposed —
 * protection gates the public Caddy HTTP route. See
 * docs/designs/deployment-protection.md.
 */

import { useQuery } from "@tanstack/react-query";

import { DeploymentProtectionCell } from "@/features/projects/components/networking/deployment-protection-cell";
import { SettingsCard } from "@/features/resources/components/_shared/settings-card";
import { orpc } from "@/shared/server/orpc";

export function ServiceProtectionCard({
  resource,
}: {
  resource: { projectId: string; resourceId: string; publicEnabled: boolean };
}) {
  const routes = useQuery(
    orpc.project.proxyRoute.list.queryOptions({
      input: { projectId: resource.projectId as never },
    }),
  );

  const route = (routes.data ?? []).find(
    (r) => r.resourceId === resource.resourceId && r.type === "http",
  );

  return (
    <SettingsCard
      title="Deployment protection"
      description="Put a login wall in front of the public URL — only members of this organization can view the deployment after signing in."
    >
      {!resource.publicEnabled || !route ? (
        <div className="px-3 py-2.5 text-[12px] text-muted-foreground">
          Expose the service publicly first — protection gates the public HTTP route.
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 px-3 py-2.5">
          <div className="flex flex-col">
            <span className="text-[13px] font-medium">Require login to view</span>
            <span className="text-[11px] text-muted-foreground">
              {route.protected
                ? `Members only — share links + CI bypass via the icon.`
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
