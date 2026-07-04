/**
 * Presentational pieces for {@link ServiceResourcePanel} — pulled into a
 * sibling module so the panel component stays small. The header (back /
 * restart / build / close), the status row, and the status badge live here.
 */

import { Cancel01Icon, RefreshIcon, RocketIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type { FrameworkKind } from "@/features/projects/components/framework-logo";

import { PanelIcon } from "@/features/resources/components/_shared/atoms";
import { Button } from "@/shared/components/ui/button";

interface HeaderResource {
  name: string;
  image: string;
  source: "image" | "git";
}

export function ServicePanelHeader({
  resource,
  framework,
  pending,
  onClose,
  onRestart,
  restarting,
  onBuild,
  building,
}: {
  resource: HeaderResource;
  framework?: FrameworkKind | null;
  pending: boolean;
  onClose: () => void;
  onRestart: () => void;
  restarting: boolean;
  onBuild: () => void;
  building: boolean;
}) {
  // `pending:<ref>` is the placeholder image a service carries until its first
  // successful build/deploy — so this service has never actually run yet.
  const neverDeployed = resource.image.startsWith("pending:");
  const isGit = resource.source === "git";

  return (
    <div className="flex items-start justify-between gap-4 px-6 pt-6">
      <div className="flex items-start gap-3">
        <PanelIcon
          node={{
            kind: "service",
            name: resource.name,
            description: resource.image,
            framework,
          }}
        />
        <div className="flex flex-col gap-0.5">
          <span className="text-xl leading-none font-bold tracking-tight">{resource.name}</span>
          <span className="font-mono text-xs text-muted-foreground">{resource.image}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {/* Runtime actions need a deployed service — omit them while the
            service is still a staged create (Deploy from the pending bar). */}
        {pending ? null : (
          <>
            {/* Restart only makes sense once something is actually running —
                there's nothing to restart on a service that never deployed. */}
            {!neverDeployed && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onRestart}
                disabled={restarting}
              >
                <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} className="size-3.5" />
                {restarting ? "Restarting…" : "Restart"}
              </Button>
            )}
            {/* Primary deploy action. Git services build a fresh image from
                HEAD (onBuild); image services re-roll their pinned image
                (onRestart). Labelled Deploy the first time, Redeploy after. */}
            {isGit ? (
              <Button type="button" size="sm" onClick={onBuild} disabled={building}>
                <HugeiconsIcon icon={RocketIcon} strokeWidth={2} className="size-3.5" />
                {building
                  ? neverDeployed
                    ? "Deploying…"
                    : "Redeploying…"
                  : neverDeployed
                    ? "Deploy"
                    : "Redeploy"}
              </Button>
            ) : neverDeployed ? (
              <Button type="button" size="sm" onClick={onRestart} disabled={restarting}>
                <HugeiconsIcon icon={RocketIcon} strokeWidth={2} className="size-3.5" />
                {restarting ? "Deploying…" : "Deploy"}
              </Button>
            ) : null}
          </>
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
}: {
  status: string;
  replicas: number;
  publicEnabled: boolean;
  publicDomain: string | null;
}) {
  return (
    <div className="mt-5 flex items-center gap-3 border-t border-border/40 px-6 py-3">
      <StatusBadge status={status} />
      <span className="text-[13px] text-muted-foreground">
        {replicas} desired replica{replicas === 1 ? "" : "s"}
        {publicEnabled && publicDomain ? ` · public on ${publicDomain}` : ""}
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
