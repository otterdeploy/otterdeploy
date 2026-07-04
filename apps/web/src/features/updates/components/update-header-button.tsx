/**
 * Persistent header affordance — an "Update" pill that shows whenever an update
 * is available (it ignores dismissal, so after the operator dismisses the banner
 * there's still a quiet, always-there way to open the update modal).
 */
import { ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";

import { useUpdateStatus } from "../data/use-update-status";
import { useUpdate } from "./update-provider";

export function UpdateHeaderButton() {
  const status = useUpdateStatus();
  const { openUpdate } = useUpdate();

  if (!status.available || !status.latest) return null;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-8 gap-1.5 border-primary/40 text-primary hover:text-primary"
      onClick={openUpdate}
      title={`Update available: ${status.latest}`}
    >
      <HugeiconsIcon icon={ArrowUp01Icon} className="size-4" strokeWidth={2} />
      Update
      <span className="font-mono text-[11px] opacity-80">{status.latest}</span>
    </Button>
  );
}
