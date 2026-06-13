/**
 * Shown when the URL points at a resource id that doesn't exist in
 * either the live resource collection or the static `INITIAL_NODES_BY_ID`
 * canvas fallback.
 */

import { HugeiconsIcon } from "@hugeicons/react";
import { Database02Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/shared/components/ui/button";

export function NotFound({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <HugeiconsIcon
        icon={Database02Icon}
        strokeWidth={1.5}
        className="size-10 text-muted-foreground/40"
      />
      <div className="text-sm font-medium">Resource not found</div>
      <div className="max-w-sm text-xs text-muted-foreground">
        No resource with id <span className="font-mono">{id}</span> exists in
        this project.
      </div>
      <Button variant="outline" size="sm" onClick={onClose}>
        Back to graph
      </Button>
    </div>
  );
}
