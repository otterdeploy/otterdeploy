/**
 * Shown when the URL points at a resource id that doesn't exist in the
 * live resource collection.
 */

import { Database02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/shared/components/ui/empty";

export function NotFound({ id, onClose }: { id: string; onClose: () => void }) {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <HugeiconsIcon
          icon={Database02Icon}
          strokeWidth={1.5}
          className="size-10 text-muted-foreground/40"
        />
        <EmptyTitle>Resource not found</EmptyTitle>
        <EmptyDescription>
          No resource with id <span className="font-mono">{id}</span> exists in this project.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" size="sm" onClick={onClose}>
          Back to graph
        </Button>
      </EmptyContent>
    </Empty>
  );
}
