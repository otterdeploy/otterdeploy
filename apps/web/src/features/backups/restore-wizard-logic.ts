/**
 * Restore-wizard logic — the restore runner and the target/typed-gate rule.
 * Split from `restore-wizard.tsx` so that component stays a dialog shell
 * within the file-size budget.
 */

import type { TranslationKey } from "@otterdeploy/i18n";

import { toast } from "sonner";

import type { Backup } from "./data/backups";
import type { RestoreMode } from "./restore-wizard-parts";

import { restoreBackup } from "./data/backups";
import { downloadBase64 } from "./shared";

/** Runs the chosen restore mode and reports the outcome; resolves either way. */
export function performRestore({
  backup,
  mode,
  confirm,
  isVolume,
  source,
  targetResourceId,
  targetName,
  onClose,
  t,
}: {
  backup: Backup;
  mode: RestoreMode;
  confirm: string;
  isVolume: boolean;
  source: string;
  targetResourceId?: string;
  targetName?: string;
  onClose: () => void;
  t: (key: TranslationKey, options?: Record<string, string>) => string;
}): Promise<void> {
  // `into` is `in-place` plus a target — the server has one destructive mode,
  // and `targetResourceId` is what redirects it.
  return restoreBackup({
    id: backup.id,
    mode: mode === "download" ? "download" : "in-place",
    confirm: mode === "download" ? undefined : confirm,
    ...(mode === "into" && targetResourceId ? { targetResourceId } : {}),
  })
    .then((res) => {
      if (mode === "download") {
        if (res.data && res.filename) downloadBase64(res.data, res.filename);
        else toast.error(t("backups.archiveUnavailable"));
      } else if (mode === "into") {
        toast.success(
          t("backups.restoredInto", {
            source,
            target: targetName ?? t("backups.selectedDatabase"),
          }),
        );
      } else {
        toast.success(
          isVolume
            ? t("backups.restoredVolume", { source })
            : t("backups.restoredInPlace", { source }),
        );
      }
      onClose();
    })
    .catch((err: unknown) => {
      toast.error(err instanceof Error ? err.message : t("backups.restoreFailed"));
    });
}

/**
 * Which databases this snapshot may be restored INTO, and what the typed
 * confirmation has to match.
 *
 * Extracted from the wizard body because the rule it encodes is easy to get
 * subtly wrong: the typed name always guards WHAT GETS OVERWRITTEN, which is
 * the source for an in-place restore but the TARGET when restoring into
 * another database. Inline among the wizard's other state it read as one more
 * boolean.
 */
export function useRestoreTarget({
  allResources,
  backup,
  mode,
  confirm,
  source,
  targetResourceId,
}: {
  allResources: readonly { type: string; resourceId: string; name: string; engine?: string }[];
  backup: Backup;
  mode: RestoreMode;
  confirm: string;
  source: string;
  targetResourceId: string;
}) {
  // Same-engine databases, excluding the snapshot's own source. The server
  // enforces the engine match too; filtering here means the operator is never
  // offered a target that will be refused.
  const sourceDb = allResources.find(
    (r) => r.type === "database" && r.resourceId === backup.resourceId,
  );
  const targets = allResources.filter(
    (r) =>
      r.type === "database" &&
      r.resourceId !== backup.resourceId &&
      (sourceDb ? r.engine === sourceDb.engine : true),
  );
  const target = targets.find((r) => r.resourceId === targetResourceId);
  const targetName = target?.name;
  const overwritten = mode === "into" ? (targetName ?? "") : source;
  const typedOk =
    mode === "download" ||
    (confirm === overwritten && overwritten !== "" && (mode !== "into" || Boolean(target)));

  return { targets, target, targetName, overwritten, typedOk };
}

