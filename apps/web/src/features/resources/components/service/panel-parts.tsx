/**
 * Presentational pieces for {@link ServiceResourcePanel} — pulled into a
 * sibling module so the panel component stays small. The header (pause /
 * restart / build / close), the status row, and the status badges live here.
 */

import { useState } from "react";

import {
  Cancel01Icon,
  PauseIcon,
  PlayIcon,
  RefreshIcon,
  RocketIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type { FrameworkKind } from "@/features/projects/components/framework-logo";

import { PanelIcon } from "@/features/resources/components/_shared/atoms";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog";
import { Button } from "@/shared/components/ui/button";

import { replicaSummary } from "./service-status";

interface HeaderResource {
  name: string;
  image: string;
  source: "image" | "git";
}

/** Pause/resume wiring for the header. Omitted (null/undefined) while the
 *  live service view hasn't loaded — the button never renders on guessed
 *  state. */
export interface PauseControl {
  paused: boolean;
  onPause: () => void;
  onResume: () => void;
  busy: boolean;
}

function PauseResumeButton({ name, control }: { name: string; control: PauseControl }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  if (control.paused) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={control.onResume}
        disabled={control.busy}
      >
        <HugeiconsIcon icon={PlayIcon} strokeWidth={2} className="size-3.5" />
        {control.busy ? "Resuming…" : "Resume"}
      </Button>
    );
  }
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setConfirmOpen(true)}
        disabled={control.busy}
      >
        <HugeiconsIcon icon={PauseIcon} strokeWidth={2} className="size-3.5" />
        {control.busy ? "Pausing…" : "Pause"}
      </Button>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pause {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              All replicas stop and the service goes unreachable until you resume. Config,
              variables, domains, and volumes are kept — Resume restores the current replica count.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              render={
                <Button variant="ghost" size="sm">
                  Cancel
                </Button>
              }
            />
            <AlertDialogAction
              variant="outline"
              size="sm"
              onClick={() => {
                setConfirmOpen(false);
                control.onPause();
              }}
            >
              <HugeiconsIcon icon={PauseIcon} strokeWidth={2} className="size-3.5" />
              Pause service
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
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
  // `pending:<ref>` is the placeholder image a service carries until its first
  // successful build/deploy — so this service has never actually run yet.
  const neverDeployed = resource.image.startsWith("pending:");
  const isGit = resource.source === "git";
  const paused = pause?.paused ?? false;

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
            {/* Pause/Resume renders only once the live view has loaded and
                never for a never-deployed service. */}
            {!neverDeployed && pause && <PauseResumeButton name={resource.name} control={pause} />}
            {/* Restart only makes sense once something is actually running —
                nothing to restart on a never-deployed or paused service
                (restarting a paused one would re-roll zero replicas). */}
            {!neverDeployed && !paused && (
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
                (onRestart). Labelled Deploy the first time, Redeploy after.
                Hidden while paused — resume first, then deploy. */}
            {paused ? null : isGit ? (
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
    <div className="mt-5 flex items-center gap-3 border-t border-border/40 px-6 py-3">
      {paused ? <PausedBadge /> : <StatusBadge status={status} />}
      <span className="text-[13px] text-muted-foreground">
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
