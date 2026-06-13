/**
 * Networking → Access tab: an always-visible home for "who can view each
 * deployed app". One card per HTTP route with the auth-wall toggle and,
 * when the wall is on, the guest / shareable-link / CI-token controls
 * inline — so inviting a guest no longer means hunting behind a per-row
 * shield icon. Layer-4 (database) routes can't carry an auth wall and are
 * omitted.
 */

import {
  Database02Icon,
  ServerStack01Icon,
  ShieldKeyIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Card } from "@/shared/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { ProtectionSwitch } from "@/features/projects/components/networking/protection-switch";
import { RouteAccessControls } from "@/features/projects/components/networking/route-access-controls";

export interface AccessRoute {
  id: string;
  name: string;
  kind: "service" | "database" | "platform";
  domain: string;
  protected: boolean;
  isHttp: boolean;
}

export function DeploymentAccessTab({
  routes,
  projectId,
  isLoading,
}: {
  routes: AccessRoute[];
  projectId: string;
  isLoading: boolean;
}) {
  const httpRoutes = routes.filter((r) => r.isHttp);

  if (isLoading && routes.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    );
  }

  if (httpRoutes.length === 0) {
    return (
      <Empty className="border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={ShieldKeyIcon} strokeWidth={1.6} className="size-5 text-muted-foreground" />
          </EmptyMedia>
          <EmptyTitle>No deployments to protect</EmptyTitle>
          <EmptyDescription>
            Expose a service over HTTP to require login, invite guests, or share
            a link. Database (layer-4) routes can&apos;t carry an auth wall.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12.5px] text-muted-foreground">
        Require sign-in to view a deployment, then invite external guests by
        email, share a no-login link, or issue a CI bypass token.
      </p>
      {httpRoutes.map((route) => (
        <RouteAccessCard key={route.id} route={route} projectId={projectId} />
      ))}
    </div>
  );
}

function RouteAccessCard({ route, projectId }: { route: AccessRoute; projectId: string }) {
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-center gap-3 border-b bg-muted/30 px-4 py-3">
        <HugeiconsIcon
          icon={route.kind === "database" ? Database02Icon : ServerStack01Icon}
          strokeWidth={1.8}
          className="size-4 text-muted-foreground"
        />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[13px]">{route.name}</div>
          <div className="truncate font-mono text-[11.5px] text-muted-foreground">
            https://{route.domain}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-muted-foreground">
            {route.protected ? "login required" : "public"}
          </span>
          <ProtectionSwitch route={route} projectId={projectId} />
        </div>
      </div>

      <div className="p-4">
        {route.protected ? (
          <RouteAccessControls routeId={route.id} />
        ) : (
          <p className="text-[12.5px] text-muted-foreground">
            This deployment is public — anyone with the URL can view it. Turn on
            protection to require sign-in and invite guests, generate a
            shareable link, or issue a CI bypass token.
          </p>
        )}
      </div>
    </Card>
  );
}
