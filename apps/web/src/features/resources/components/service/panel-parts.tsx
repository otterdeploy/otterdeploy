/**
 * Presentational pieces for {@link ServiceResourcePanel} — pulled into a
 * sibling module so the panel component stays small. The header (pause /
 * restart / build / close), the status row, and the status badges live here;
 * the header's runtime action cluster lives in `panel-header-actions.tsx`.
 */

import { Cancel01Icon, PauseIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type { FrameworkKind } from "@/features/projects/components/framework-logo";

import { PanelIcon } from "@/features/resources/components/_shared/atoms";
import { Button } from "@/shared/components/ui/button";
import { shortImageRef } from "@/shared/lib/image-ref";

import { HeaderActions, type HeaderResource, type PauseControl } from "./panel-header-actions";
import { replicaSummary } from "./service-status";

export type { PauseControl };

export function ServicePanelHeader({
  resource,
  framework,
  pending,
  onClose,
  onRestart,
  restarting,
  onBuild,
  building,
  pause,
}: {
  resource: HeaderResource;
  framework?: FrameworkKind | null;
  pending: boolean;
  onClose: () => void;
  onRestart: () => void;
  restarting: boolean;
  onBuild: () => void;
  building: boolean;
  /** Null/undefined until the live service view is loaded (or pending mode). */
  pause?: PauseControl | null;
}) {
  return (
    <div className="flex items-start justify-between gap-2 px-4 pt-4 sm:gap-4 sm:px-6 sm:pt-6">
      {/* min-w-0 so the name/image below truncate instead of forcing this row
          wider than the panel and pushing the actions off-screen. */}
      <div className="flex min-w-0 items-start gap-2 sm:gap-3">
        <PanelIcon
          node={{
            kind: "service",
            name: resource.name,
            description: resource.image,
            framework,
          }}
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-lg leading-tight font-bold tracking-tight sm:text-xl sm:leading-none">
            {resource.name}
          </span>
          <span className="truncate font-mono text-xs text-muted-foreground" title={resource.image}>
            {shortImageRef(resource.image)}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        {/* Runtime actions need a deployed service — omit them while the
            service is still a staged create (Deploy from the pending bar). */}
        {pending ? null : (
          <HeaderActions
            resource={resource}
            onRestart={onRestart}
            restarting={restarting}
            onBuild={onBuild}
            building={building}
            pause={pause}
          />
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close panel"
          onClick={onClose}
        >
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function ServiceStatusBar({
  status,
  replicas,
  publicEnabled,
  publicDomain,
  pausedReplicas,
}: {
  status: string;
  replicas: number;
  publicEnabled: boolean;
  publicDomain: string | null;
  /** Non-null = paused. Undefined while the live view is loading — the bar
   *  falls back to the plain resource status rather than guessing. */
  pausedReplicas?: number | null;
}) {
  const paused = pausedReplicas != null;
  return (
    // flex-wrap: badge + "3 replicas · public on foo.example.com" overflows a
    // phone on one line; it wraps under the badge instead of scrolling sideways.
    <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border/40 px-4 py-3 sm:px-6">
      {paused ? <PausedBadge /> : <StatusBadge status={status} />}
      <span className="min-w-0 text-[13px] break-words text-muted-foreground">
        {replicaSummary({ replicas, pausedReplicas: pausedReplicas ?? null })}
        {!paused && publicEnabled && publicDomain ? ` · public on ${publicDomain}` : ""}
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "valid"
      ? "bg-success/12 text-success"
      : status === "draft"
        ? "bg-warning/12 text-warning"
        : status === "invalid"
          ? "bg-destructive/12 text-destructive"
          : "bg-muted text-muted-foreground";
  return (
    <span
      className={`rounded-md px-2 py-1 font-mono text-[10.5px] font-semibold tracking-[0.18em] ${tone}`}
    >
      {status.toUpperCase()}
    </span>
  );
}

// Deliberately muted, not destructive: paused is an operator choice, not a
// failure. The icon keeps the state readable without relying on color alone.
function PausedBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 font-mono text-[10.5px] font-semibold tracking-[0.18em] text-muted-foreground">
      <HugeiconsIcon icon={PauseIcon} strokeWidth={2.5} className="size-3" />
      PAUSED
    </span>
  );
}
