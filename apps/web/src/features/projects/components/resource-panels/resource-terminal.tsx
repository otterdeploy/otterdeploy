/**
 * Shell terminal panel for a resource (service or database).
 *
 * Resolves the resource → its running container via the existing
 * `terminalContainersCollection` TanStack DB collection, then mounts
 * `<TerminalSession>` against that container's id. "Reconnect" /
 * "Clear" remount the session by bumping a generation key — clean way
 * to recycle the underlying WebSocket + PTY.
 *
 * `projectSlug` arrives as a prop instead of being read off the route
 * so this panel doesn't bind to any specific route file; the parent
 * passes it through.
 */

import { useMemo, useState } from "react";
import { useLiveQuery } from "@tanstack/react-db";
import { HugeiconsIcon } from "@hugeicons/react";
import { Maximize01Icon } from "@hugeicons/core-free-icons";

import { TerminalSession } from "@/features/terminal/components/terminal-session";
import { terminalContainersCollection } from "@/features/terminal/data/targets";
import type { SessionSource } from "@/features/terminal/types";
import { Button } from "@/shared/components/ui/button";

export type ResourceTerminalMatch =
  | { kind: "service"; resourceId: string }
  | {
      kind: "database";
      /** Engine label expected on the container — terminal-targets
       *  stamps this from `otterdeploy.resource.type`. Drives whether the
       *  shell can attach (only running containers with the matching
       *  engine label show up). */
      engine: "postgres" | "redis" | "mariadb" | "mongodb";
      serviceName: string;
    };

interface ResourceTerminalProps {
  match: ResourceTerminalMatch;
  fallbackLabel: string;
  projectSlug: string;
}

export function ResourceTerminal({
  match,
  fallbackLabel,
  projectSlug,
}: ResourceTerminalProps) {
  const { data: containers = [] } = useLiveQuery(
    () => terminalContainersCollection,
  );

  const target = useMemo(() => {
    if (match.kind === "service") {
      return containers.find(
        (c) =>
          c.resourceType === "service" &&
          c.serviceResourceId === match.resourceId,
      );
    }
    return containers.find(
      (c) =>
        c.resourceType === match.engine && c.serviceName === match.serviceName,
    );
  }, [containers, match]);

  const [generation, setGeneration] = useState(0);

  const headerLabel = target
    ? `sh · ${target.name}${target.replicaSlot ? `.${target.replicaSlot}` : ""}`
    : `sh · ${fallbackLabel}`;

  return (
    <div className="flex flex-col gap-0 overflow-hidden rounded-lg border border-border/40 bg-[oklch(0.12_0_0)]">
      <div className="flex items-center justify-between gap-3 border-b border-border/40 bg-muted/10 px-3 py-2">
        <span className="font-mono text-[11px] text-muted-foreground">
          {headerLabel}
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px]"
            disabled={!target}
            onClick={() => setGeneration((g) => g + 1)}
          >
            Reconnect
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px]"
            disabled={!target}
            onClick={() => setGeneration((g) => g + 1)}
          >
            Clear
          </Button>
          <Button variant="outline" size="icon-sm" aria-label="Fullscreen">
            <HugeiconsIcon
              icon={Maximize01Icon}
              strokeWidth={2}
              className="size-3.5"
            />
          </Button>
        </div>
      </div>
      <div className="relative h-[460px]">
        {target ? (
          <TerminalSession
            key={`${target.containerId}:${generation}`}
            source={
              {
                kind: "container",
                project: projectSlug,
                service: target.serviceName ?? target.name,
                replica: target.replicaSlot ?? "1",
                containerId: target.containerId,
              } satisfies SessionSource
            }
            active
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
            <span className="font-mono text-[12px] text-muted-foreground/80">
              No running container.
            </span>
            <span className="text-[11.5px] text-muted-foreground/60">
              Once a task is scheduled for this resource, the shell will open
              automatically.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
