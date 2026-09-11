/**
 * The two confirms behind the deployments feed's row actions.
 *
 * Split from `deployment-actions.tsx` because a confirm dialog is mostly the
 * sentence it says, and those sentences are the actual product: they are the
 * last thing an operator reads before killing a build or re-rolling a service,
 * and they belong somewhere they can be read as prose rather than buried
 * between two composition functions.
 */

import { useState } from "react";

import { RotateLeft01Icon, StopIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";

import type { DeploymentRow } from "@/features/deployments/table/deployment-cells";

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
import { shortImageRef } from "@/shared/lib/image-ref";

/**
 * `starting` is deliberately NOT cancellable.
 *
 * It mirrors `CANCELLABLE` in packages/api/src/routers/deployment/cancel.ts: by
 * the time a deployment is starting, the image is built and swarm is rolling it
 * out, so there is no build left to stop. Offering the button anyway would put
 * a 409 behind a confirm dialog.
 */
export function isCancellable(status: string): boolean {
  return status === "pending" || status === "building";
}

/** Icon-only, with the verb in the tooltip: the shell's rows are one line tall
 *  and three words of button would crowd out the column it sits beside. */
function IconAction({
  icon,
  label,
  danger = false,
  disabled = false,
  onClick,
}: {
  icon: typeof StopIcon;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-6"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <HugeiconsIcon
        icon={icon}
        strokeWidth={2}
        className={danger ? "size-3.5 text-destructive" : "size-3.5"}
      />
    </Button>
  );
}

export function CancelAction({
  row,
  onCancel,
}: {
  row: DeploymentRow;
  onCancel: (row: DeploymentRow) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  return (
    <AlertDialog open={confirming} onOpenChange={setConfirming}>
      <IconAction
        icon={StopIcon}
        danger
        label={t("deployments.stopBuild")}
        disabled={pending}
        onClick={() => setConfirming(true)}
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("deployments.stopBuild")}</AlertDialogTitle>
          <AlertDialogDescription>
            The build container for{" "}
            <span className="font-mono text-foreground">{row.resourceName}</span> is killed
            immediately and this deployment is recorded as cancelled. Work already done is
            discarded, so starting again means a fresh deploy.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("deployments.keepBuilding")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              // Keep the dialog up while the request is in flight, then close
              // on settle — the row itself is what reports the outcome.
              event.preventDefault();
              setPending(true);
              void onCancel(row).finally(() => {
                setPending(false);
                setConfirming(false);
              });
            }}
          >
            {pending ? "Stopping…" : "Stop build"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Rollback is consequential but RECOVERABLE — you can roll forward again from
 * this same history — so it takes a plain confirm rather than the
 * type-the-name gate the destructive dialogs use.
 */
export function RollbackAction({
  row,
  onRollback,
}: {
  row: DeploymentRow;
  onRollback: (row: DeploymentRow) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  return (
    <AlertDialog open={confirming} onOpenChange={setConfirming}>
      <IconAction
        icon={RotateLeft01Icon}
        label={t("deployments.rollBack")}
        disabled={pending}
        onClick={() => setConfirming(true)}
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Roll back <span className="font-mono">{row.resourceName}</span>?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Re-deploys{" "}
            <span className="font-mono text-foreground">
              {row.gitSha === null ? shortImageRef(row.image) : row.gitSha.slice(0, 7)}
            </span>{" "}
            with the service&apos;s <em>current</em> configuration. Environment and settings changed
            since then are kept — only the image goes back. You can roll forward again from this
            same history.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              setPending(true);
              void onRollback(row).finally(() => {
                setPending(false);
                setConfirming(false);
              });
            }}
          >
            {pending ? t("deployments.rollingBackPending") : t("deployments.rollBack")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
