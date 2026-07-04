/**
 * App-wide "an update is available" banner. Loud but dismissible: dismissing
 * pins the current available version so it stays hidden until a NEWER one ships
 * (the header button remains as the quiet, always-there affordance).
 */
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";

import { useDismissUpdate, useUpdateStatus } from "../data/use-update-status";
import { useUpdate } from "./update-provider";

export function UpdateBanner() {
  const status = useUpdateStatus();
  const { openUpdate } = useUpdate();
  const dismiss = useDismissUpdate();

  if (!status.bannerVisible || !status.latest) return null;

  return (
    <div className="flex items-center gap-3 border-b border-primary/20 bg-primary/5 px-4 py-2 text-[13px]">
      <span className="font-medium">A new version of otterdeploy is available</span>
      <Badge className="font-mono">{status.latest}</Badge>
      {status.dryRun && (
        <Badge variant="secondary" title="Dev/dry-run install — applying runs as a simulation.">
          dry-run
        </Badge>
      )}
      <div className="ml-auto flex items-center gap-1.5">
        <Button type="button" size="sm" onClick={openUpdate}>
          What's new
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label="Dismiss"
          disabled={dismiss.isPending}
          onClick={() => dismiss.mutate({ dismissedVersion: status.latest })}
        >
          <HugeiconsIcon icon={Cancel01Icon} className="size-4" strokeWidth={2} />
        </Button>
      </div>
    </div>
  );
}
