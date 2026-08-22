import { useEffect, useRef, useState } from "react";

/**
 * The one update modal. Confirm → live progress → done, all in a dialog (not
 * inline). Opened from the banner, the header button, or the Platform card via
 * the UpdateProvider. Reads the shared status so it always reflects the latest
 * check. While a REAL run is in flight the dialog refuses to close (every
 * dismissal path — the ✕, the backdrop, Escape — funnels through Base UI's
 * onOpenChange, so one intercept covers them all); dry runs stay dismissable
 * because nothing real is moving.
 */
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Markdown } from "@/shared/components/ui/markdown";
import { orpc, queryClient } from "@/shared/server/orpc";

import { useUpdateState, useUpdateStatus } from "../data/use-update-status";
import { UpdateProgress } from "./update-progress";
import { deriveOutcome } from "./update-progress-model";

/**
 * The release's own repository, read off its html_url
 * (`https://github.com/owner/name/releases/tag/v1.2.3`). Handed to the notes
 * renderer so the generated "… in <pull URL>" lines collapse to `#154` the way
 * they do on GitHub, instead of one full-width URL per merged PR.
 */
function repoFromReleaseUrl(url: string | null | undefined): string | undefined {
  return /^https:\/\/github\.com\/([^/]+\/[^/]+)\//.exec(url ?? "")?.[1];
}

/**
 * Wraps the dialog's onOpenChange so a close attempt while `blockClose` holds
 * is refused with a transient hint instead of dismissing the dialog. Every
 * dismissal path (the ✕, the backdrop, Escape) funnels through onOpenChange,
 * so this one intercept covers them all.
 */
function useGuardedOpenChange(
  blockClose: boolean,
  onClose: () => void,
  onOpenChange: (open: boolean) => void,
) {
  const [closeHint, setCloseHint] = useState(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(hintTimer.current ?? undefined), []);
  const handleOpenChange = (next: boolean) => {
    if (!next && blockClose) {
      setCloseHint(true);
      if (hintTimer.current) clearTimeout(hintTimer.current);
      hintTimer.current = setTimeout(() => setCloseHint(false), 3000);
      return;
    }
    if (!next) {
      onClose();
      setCloseHint(false);
    }
    onOpenChange(next);
  };
  return { closeHint, handleOpenChange };
}

function reasonKey(reason: "already-running" | "no-update" | "downgrade") {
  switch (reason) {
    case "already-running":
      return "updates.reasonAlreadyRunning" as const;
    case "no-update":
      return "updates.reasonNoUpdate" as const;
    case "downgrade":
      return "updates.reasonDowngrade" as const;
  }
}

/** Title + the version chips: "Updating otterdeploy  [v0.15.0] → [v0.15.1]". */
function UpdateDialogTitle({
  active,
  status,
}: {
  active: { dryRun: boolean } | null;
  status: ReturnType<typeof useUpdateStatus>;
}) {
  const { t } = useTranslation();
  return (
    <DialogTitle className="flex items-center gap-2">
      {active
        ? active.dryRun
          ? t("updates.titleSimulating")
          : t("updates.titleUpdating")
        : t("updates.titleIdle")}
      {status.latest && (
        <>
          <Badge variant="outline" className="font-mono">
            {status.current}
          </Badge>
          <span className="text-muted-foreground">→</span>
          <Badge className="font-mono">{status.latest}</Badge>
        </>
      )}
      {status.dryRun && <Badge variant="secondary">dry-run</Badge>}
    </DialogTitle>
  );
}

/** A close is refused only for a REAL run that hasn't settled. An unknown run
 *  status (still loading) blocks too: refusing a close for a beat is cheap,
 *  allowing one mid-cutover orphans the operator. */
function shouldBlockClose(
  active: { dryRun: boolean } | null,
  runStatus: Parameters<typeof deriveOutcome>[1],
): boolean {
  if (active === null || active.dryRun) return false;
  return !deriveOutcome(false, runStatus).terminal;
}

export function UpdateDialog({
  open,
  onOpenChange,
  attached,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A run already in flight (from the persisted state) to re-attach to when
   *  this browser didn't start it. A fresh local apply takes precedence. */
  attached?: { target: string; dryRun: boolean } | null;
}) {
  const { t } = useTranslation();
  const status = useUpdateStatus();
  const runState = useUpdateState();
  const [applying, setApplying] = useState<{ target: string; dryRun: boolean } | null>(null);

  // A locally-started apply wins; otherwise fall back to a re-attached run.
  const active = applying ?? attached ?? null;
  const blockClose = shouldBlockClose(active, runState.data?.status);

  // Resetting the applying view on close lives in the handler, not an effect.
  const { closeHint, handleOpenChange } = useGuardedOpenChange(
    blockClose,
    () => setApplying(null),
    onOpenChange,
  );

  const apply = useMutation({
    ...orpc.system.apply.mutationOptions(),
    onSuccess: (res) => {
      // Refresh the persisted run-state either way: on start so the progress
      // pane doesn't read a PRIOR run's terminal status (it only polls while
      // running), and on already-running so we re-attach to the live run
      // instead of leaving the operator with just a toast.
      void queryClient.invalidateQueries({ queryKey: orpc.system.updateState.queryKey() });
      if (res.started) setApplying({ target: res.targetVersion, dryRun: res.dryRun });
      else if (res.reason === "already-running") {
        toast.message(t(reasonKey(res.reason)));
      } else {
        toast.message(t(reasonKey(res.reason)));
        handleOpenChange(false);
      }
    },
    onError: (e) => toast.error(e.message ?? t("updates.startFailed")),
  });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <UpdateDialogTitle active={active} status={status} />
          {!active && (
            <DialogDescription>
              {status.dryRun ? t("updates.descriptionDryRun") : t("updates.descriptionReal")}
            </DialogDescription>
          )}
          {closeHint && (
            <p className="text-xs text-warning" role="status">
              {t("updates.closeBlocked")}
            </p>
          )}
        </DialogHeader>

        {active ? (
          <UpdateProgress
            target={active.target}
            dryRun={active.dryRun}
            onDone={() => handleOpenChange(false)}
          />
        ) : (
          status.notes && (
            <div className="flex flex-col gap-1.5">
              <div className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                {t("updates.releaseNotes")}
              </div>
              <Markdown
                repo={repoFromReleaseUrl(status.url)}
                className="max-h-[280px] overflow-auto rounded-md border bg-muted/40 px-3 py-1.5"
              >
                {status.notes}
              </Markdown>
            </div>
          )
        )}

        {!active && (
          <DialogFooter>
            {status.url && (
              <a
                href={status.url}
                target="_blank"
                rel="noreferrer"
                className="mr-auto self-center text-[12px] text-primary underline-offset-4 hover:underline"
              >
                {t("updates.viewRelease")}
              </a>
            )}
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="button" disabled={apply.isPending} onClick={() => apply.mutate({})}>
              {apply.isPending
                ? t("updates.starting")
                : status.dryRun
                  ? t("updates.runSimulation")
                  : t("updates.updateNow")}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
