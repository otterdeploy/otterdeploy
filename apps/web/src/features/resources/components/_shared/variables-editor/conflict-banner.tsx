// Shown when a save was refused because the variables changed elsewhere
// since this editor loaded them (another tab, a teammate, `env set`).
// The draft is untouched; "Reload to merge" re-bases it on the
// current set so the other writer's variables survive the next save.

import { useState } from "react";

import { ORPCError } from "@orpc/client";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";

export function ConflictBanner({ onReload }: { onReload: () => void }) {
  const { t } = useTranslation();
  return (
    <Alert role="alert" className="flex items-center gap-3">
      <AlertDescription className="flex-1 text-[13px]">
        {t("resources.variablesConflict")}
      </AlertDescription>
      <Button size="sm" variant="outline" className="h-7 shrink-0" onClick={onReload}>
        {t("resources.variablesReloadToMerge")}
      </Button>
    </Alert>
  );
}

/**
 * The editor's save-error handling. A CONFLICT (the set changed since this
 * editor loaded it) shows the banner instead of a toast, keeps the draft, and
 * refetches the current set so "Reload to merge" re-bases onto it; anything
 * else toasts as before.
 */
export function useEnvConflict(refresh: () => Promise<unknown>, rebase: () => void) {
  const { t } = useTranslation();
  const [conflicted, setConflicted] = useState(false);
  const onSaveError = (err: Error) => {
    if (err instanceof ORPCError && err.code === "CONFLICT") {
      setConflicted(true);
      void refresh();
      return;
    }
    toast.error(err.message ?? t("resources.variablesSaveFailed"));
  };
  const reloadToMerge = () => {
    rebase();
    setConflicted(false);
  };
  return { conflicted, onSaveError, reloadToMerge };
}
