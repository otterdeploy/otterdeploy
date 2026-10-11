/**
 * Two tabs, one environment's variables. The bulk editor's
 * apply names the version of the saved set its text was built from (its
 * "base"); a set another tab changed since is refused with CONFLICT. This
 * holds that base, the conflict flag, and "Reload to merge", which re-bases
 * the operator's text on the set saved now (variables-merge.ts) without losing
 * either side. Split from variables-bulk-edit.tsx (size).
 */

import { envSetVersion } from "@otterdeploy/shared/env-version";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { VariableDraft } from "@/features/projects/data/variable-drafts";

import { setVariableDraft } from "@/features/projects/data/variable-drafts";
import { PROJECT_VARIABLES_COLLECTION_KEY } from "@/features/projects/data/variables";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";
import { queryClient } from "@/shared/server/orpc";

import type { EnvVarRow } from "./variables-types";

import { mergeEnvText } from "./variables-merge";

export function useBulkEditBase({
  projectId,
  environmentId,
  currentRows,
  initial,
  storedDraft,
}: {
  projectId: string;
  environmentId: string;
  currentRows: EnvVarRow[];
  /** The saved rows as .env text: the editor's pristine text. */
  initial: string;
  storedDraft: VariableDraft | undefined;
}) {
  // A restored draft's own base when it recorded one, else the rows as they
  // are now.
  const [base, setBase] = useState(() =>
    storedDraft?.baseVersion !== undefined && storedDraft.baseText !== undefined
      ? { version: storedDraft.baseVersion, text: storedDraft.baseText }
      : { version: envSetVersion(currentRows), text: initial },
  );
  const [conflicted, setConflicted] = useState(false);

  /** The apply was refused as stale: keep the text, fetch the current set. */
  const markConflicted = () => {
    setConflicted(true);
    void queryClient.invalidateQueries({ queryKey: PROJECT_VARIABLES_COLLECTION_KEY });
  };

  /** The editor now shows the saved rows (draft discarded). */
  const resetBase = () => setBase({ version: envSetVersion(currentRows), text: initial });

  /** Reload to merge: the operator's text re-based on the set saved now. */
  const merge = (text: string): string => {
    const merged = mergeEnvText(base.text, text, currentRows);
    const nextBase = { version: envSetVersion(currentRows), text: initial };
    setBase(nextBase);
    setConflicted(false);
    setVariableDraft({
      projectId,
      environmentId,
      text: merged,
      pristine: initial,
      base: nextBase,
      rebase: true,
    });
    return merged;
  };

  return { base, conflicted, markConflicted, resetBase, merge };
}

export function BulkConflictBanner({ onReload }: { onReload: () => void }) {
  const { t } = useTranslation();
  return (
    <Alert role="alert" className="flex items-center gap-3 rounded-none border-x-0 border-t-0">
      <AlertDescription className="flex-1 text-[13px]">{t("variables.conflict")}</AlertDescription>
      <Button size="sm" variant="outline" className="h-7 shrink-0" onClick={onReload}>
        {t("variables.reloadToMerge")}
      </Button>
    </Alert>
  );
}
