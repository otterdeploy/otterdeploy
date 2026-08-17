/**
 * The service panel header's runtime action cluster. Pause/resume (with its
 * confirm dialog), restart, and the primary deploy button. Split out of
 * `panel-parts.tsx` to keep that module within the file-size budget.
 */

import { useState } from "react";

import { PauseIcon, PlayIcon, RefreshIcon, RocketIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

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

export interface HeaderResource {
  name: string;
  image: string;
  source: "image" | "git" | "upload";
}

/** Pause/resume wiring for the header. Omitted (null/undefined) while the
 *  live service view hasn't loaded. The button never renders on guessed
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
        aria-label={control.busy ? "Resuming" : "Resume"}
      >
        <HugeiconsIcon icon={PlayIcon} strokeWidth={2} className="size-3.5" />
        {/* Labels drop below `sm` throughout this cluster: up to three actions
            plus Close share the header row with the service name, and their
            labels alone are wider than a phone. aria-label carries the meaning. */}
        <span className="hidden sm:inline">{control.busy ? "Resuming…" : "Resume"}</span>
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
        aria-label={control.busy ? "Pausing" : "Pause"}
      >
        <HugeiconsIcon icon={PauseIcon} strokeWidth={2} className="size-3.5" />
        <span className="hidden sm:inline">{control.busy ? "Pausing…" : "Pause"}</span>
      </Button>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pause {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              All replicas stop and the service goes unreachable until you resume. Config,
              variables, domains, and volumes are kept. Resume restores the current replica count.
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

/** The header's runtime actions. Pause/resume, restart, and deploy. Only
 *  rendered for a deployed (non-pending) service. */
export function HeaderActions({
  resource,
  onRestart,
  restarting,
  onBuild,
  building,
  pause,
}: {
  resource: HeaderResource;
  onRestart: () => void;
  restarting: boolean;
  onBuild: () => void;
  building: boolean;
  pause?: PauseControl | null;
}) {
  // `pending:<ref>` is the placeholder image a service carries until its first
  // successful build/deploy, so this service has never actually run yet.
  const neverDeployed = resource.image.startsWith("pending:");
  const isGit = resource.source === "git";
  const paused = pause?.paused ?? false;
  // Hoisted so each label is computed once rather than inline in both the
  // visible text and the aria-label (which the icon-only mobile form needs).
  const restartLabel = restarting ? "Restarting…" : "Restart";

  return (
    <>
      {/* Pause/Resume renders only once the live view has loaded and
          never for a never-deployed service. */}
      {!neverDeployed && pause && <PauseResumeButton name={resource.name} control={pause} />}
      {/* Restart only makes sense once something is actually running:
          nothing to restart on a never-deployed or paused service
          (restarting a paused one would re-roll zero replicas). */}
      {!neverDeployed && !paused && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRestart}
          disabled={restarting}
          aria-label={restartLabel}
        >
          <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} className="size-3.5" />
          <span className="hidden sm:inline">{restartLabel}</span>
        </Button>
      )}
      {/* Primary deploy action. Git services build a fresh image from
          HEAD (onBuild); image services re-roll their pinned image
          (onRestart). Labelled Deploy the first time, Redeploy after.
          Hidden while paused: resume first, then deploy. */}
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
  );
}
