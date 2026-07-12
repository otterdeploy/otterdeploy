/**
 * The service panel header's runtime action cluster — pause/resume (with its
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

/** The header's runtime actions — pause/resume, restart, and deploy. Only
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
  // successful build/deploy — so this service has never actually run yet.
  const neverDeployed = resource.image.startsWith("pending:");
  const isGit = resource.source === "git";
  const paused = pause?.paused ?? false;

  return (
    <>
      {/* Pause/Resume renders only once the live view has loaded and
          never for a never-deployed service. */}
      {!neverDeployed && pause && <PauseResumeButton name={resource.name} control={pause} />}
      {/* Restart only makes sense once something is actually running —
          nothing to restart on a never-deployed or paused service
          (restarting a paused one would re-roll zero replicas). */}
      {!neverDeployed && !paused && (
        <Button type="button" variant="outline" size="sm" onClick={onRestart} disabled={restarting}>
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
  );
}
