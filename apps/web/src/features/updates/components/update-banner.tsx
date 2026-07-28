/**
 * App-wide "an update is available" banner. Loud but dismissible: dismissing
 * pins the current available version so it stays hidden until a NEWER one ships
 * (the header button remains as the quiet, always-there affordance).
 */
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";

import { useIsFirstSession } from "../data/use-is-first-session";
import { useDismissUpdate, useUpdateStatus } from "../data/use-update-status";
import { useUpdate } from "./update-provider";

export function UpdateBanner() {
  const { t } = useTranslation();
  const status = useUpdateStatus();
  const { openUpdate } = useUpdate();
  const dismiss = useDismissUpdate();
  // Suppress the loud banner during a user's first session — the quiet header
  // affordance (see the file doc comment) still surfaces the update either
  // way, so nothing is actually hidden, just not shouted on the first screen.
  const firstSession = useIsFirstSession();

  if (firstSession || !status.bannerVisible || !status.latest) return null;

  return (
    <div className="flex h-11 w-full min-w-0 shrink-0 items-center gap-3 border-b border-primary/20 bg-primary/5 px-4 text-[13px]">
      <span className="min-w-0 truncate font-medium">
        A new version of otterdeploy is available
      </span>
      <Badge className="shrink-0 font-mono">{status.latest}</Badge>
      {status.dryRun && (
        <Badge
          variant="secondary"
          className="shrink-0"
          title="Dev/dry-run install — applying runs as a simulation."
        >
          dry-run
        </Badge>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <Button type="button" size="sm" onClick={openUpdate}>
          What's new
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={t("common.dismiss")}
          disabled={dismiss.isPending}
          onClick={() => dismiss.mutate({ dismissedVersion: status.latest })}
        >
          <HugeiconsIcon icon={Cancel01Icon} className="size-4" strokeWidth={2} />
        </Button>
      </div>
    </div>
  );
}
