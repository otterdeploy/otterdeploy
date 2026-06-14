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
import { Maximize01Icon, Minimize01Icon } from "@hugeicons/core-free-icons";

import { TerminalSession } from "@/features/terminal/components/terminal-session";
import { terminalContainersCollection } from "@/features/terminal/data/targets";
import type { SessionSource } from "@/features/terminal/types";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { cn } from "@/shared/lib/utils";

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
  const [expanded, setExpanded] = useState(false);

  const headerLabel = target
    ? `sh · ${target.name}${target.replicaSlot ? `.${target.replicaSlot}` : ""}`
    : `sh · ${fallbackLabel}`;

  const session: Extract<SessionSource, { kind: "container" }> | null = target
    ? {
        kind: "container",
        project: projectSlug,
        service: target.serviceName ?? target.name,
        replica: target.replicaSlot ?? "1",
        containerId: target.containerId,
      }
    : null;

  // Reconnect / Clear both recycle the underlying WebSocket + PTY by bumping
  // the generation key — mirrors the original behaviour.
  const recycle = () => setGeneration((g) => g + 1);

  return (
    <>
      {/* Inline shell. The panel mounts us as a flex child of an
          `absolute inset-0` flex column with a real height, so `flex-1` fills
          it — no viewport math, no leftover gap. `flex-1` (not `h-full`)
          because a percentage height won't resolve against a flex/absolute
          parent, which leaves xterm unable to measure and stuck at its
          default ~24-row size. */}
      <TerminalShell
        headerLabel={headerLabel}
        session={session}
        generation={generation}
        onReconnect={recycle}
        expanded={expanded}
        onToggleExpand={() => setExpanded(true)}
        boxClassName="min-h-0 flex-1"
      />

      {/* Fullscreen — a portal overlay, same mechanism the Data tab uses. */}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="left-0 top-0 flex h-screen w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:max-w-none">
          <DialogHeader className="sr-only">
            <DialogTitle>{headerLabel}</DialogTitle>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 p-4">
            <TerminalShell
              headerLabel={headerLabel}
              session={session}
              generation={generation}
              onReconnect={recycle}
              expanded={expanded}
              onToggleExpand={() => setExpanded(false)}
              boxClassName="min-h-0 flex-1"
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface TerminalShellProps {
  headerLabel: string;
  session: Extract<SessionSource, { kind: "container" }> | null;
  generation: number;
  onReconnect: () => void;
  expanded: boolean;
  onToggleExpand: () => void;
  /** Sizing for the outer box — the height chain lives here, not inside. */
  boxClassName?: string;
}

/**
 * The terminal card itself: header (label + Reconnect/Clear/Fullscreen) over a
 * `flex-1` body that the xterm `autoResize` ResizeObserver fits into. Rendered
 * both inline and inside the fullscreen Dialog, so the only thing that varies
 * is `boxClassName`.
 */
function TerminalShell({
  headerLabel,
  session,
  generation,
  onReconnect,
  expanded,
  onToggleExpand,
  boxClassName,
}: TerminalShellProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-0 overflow-hidden rounded-lg border border-border/40 bg-[oklch(0.12_0_0)]",
        boxClassName,
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border/40 bg-muted/10 px-3 py-2">
        <span className="font-mono text-[11px] text-muted-foreground">
          {headerLabel}
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px]"
            disabled={!session}
            onClick={onReconnect}
          >
            Reconnect
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px]"
            disabled={!session}
            onClick={onReconnect}
          >
            Clear
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={expanded ? "Exit fullscreen" : "Fullscreen"}
            onClick={onToggleExpand}
          >
            <HugeiconsIcon
              icon={expanded ? Minimize01Icon : Maximize01Icon}
              strokeWidth={2}
              className="size-3.5"
            />
          </Button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        {session ? (
          <TerminalSession
            key={`${session.containerId}:${generation}`}
            source={session}
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
