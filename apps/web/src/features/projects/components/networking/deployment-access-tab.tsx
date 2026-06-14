/**
 * Networking → Access tab: "who can view each deployed app", as a master /
 * detail. The left rail lists every HTTP deployment with its protection state;
 * the right panel shows the access controls for the one you select, so you
 * only ever see a single deployment's controls at a time instead of a tall
 * stack of every route's settings. Layer-4 (database) routes can't carry an
 * auth wall and are omitted.
 */

import { useState } from "react";
import {
  Database02Icon,
  LinkSquare02Icon,
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
import { cn } from "@/shared/lib/utils";
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    httpRoutes.find((r) => r.id === selectedId) ?? httpRoutes[0] ?? null;

  if (isLoading && routes.length === 0) {
    return (
      <div className="grid grid-cols-[260px_1fr] gap-4">
        <div className="flex flex-col gap-1.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-72 rounded-xl" />
      </div>
    );
  }

  if (httpRoutes.length === 0) {
    return (
      <Empty className="border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon
              icon={ShieldKeyIcon}
              strokeWidth={1.6}
              className="size-5 text-muted-foreground"
            />
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

      <div className="grid grid-cols-[260px_1fr] items-start gap-4">
        <div className="flex flex-col gap-1">
          {httpRoutes.map((route) => (
            <DeploymentListItem
              key={route.id}
              route={route}
              active={selected?.id === route.id}
              onSelect={() => setSelectedId(route.id)}
            />
          ))}
        </div>

        {selected ? (
          <DeploymentAccessPanel
            key={selected.id}
            route={selected}
            projectId={projectId}
          />
        ) : null}
      </div>
    </div>
  );
}

function DeploymentListItem({
  route,
  active,
  onSelect,
}: {
  route: AccessRoute;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors",
        active
          ? "border-border bg-muted/50"
          : "border-transparent hover:bg-muted/30",
      )}
    >
      <HugeiconsIcon
        icon={route.kind === "database" ? Database02Icon : ServerStack01Icon}
        strokeWidth={1.8}
        className="size-4 shrink-0 text-muted-foreground"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[13px]">{route.name}</div>
        <div className="truncate font-mono text-[11px] text-muted-foreground">
          {route.domain}
        </div>
      </div>
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          route.protected ? "bg-success" : "bg-muted-foreground/40",
        )}
        title={route.protected ? "Login required" : "Public"}
      />
    </button>
  );
}

function DeploymentAccessPanel({
  route,
  projectId,
}: {
  route: AccessRoute;
  projectId: string;
}) {
  return (
    <Card className="min-w-0 gap-0 overflow-hidden p-0">
      <div className="flex items-center gap-3 border-b bg-muted/30 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[13px]">{route.name}</div>
          <a
            href={`https://${route.domain}`}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex max-w-full items-center gap-1 truncate font-mono text-[11.5px] text-muted-foreground hover:text-foreground hover:underline"
          >
            <span className="truncate">https://{route.domain}</span>
            <HugeiconsIcon
              icon={LinkSquare02Icon}
              strokeWidth={2}
              className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60"
            />
          </a>
        </div>
        <div className="flex shrink-0 items-center gap-2">
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
          <div className="flex flex-col items-start gap-1 py-2">
            <p className="text-[13px] font-medium">This deployment is public</p>
            <p className="text-[12.5px] text-muted-foreground">
              Anyone with the URL can view it. Turn on protection above to
              require sign-in and manage who can access it.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
