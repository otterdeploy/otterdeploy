/**
 * One destination in the destinations list: name + connection summary, storage
 * usage, status, and test/edit/delete affordances. Delete mutates the
 * collection optimistically; test is a one-shot validation.
 */
import { useState } from "react";
import {
  Delete02Icon,
  Settings01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

import type { Destination } from "./data/destinations";
import { destinationsCollection, testDestination } from "./data/destinations";
import { StatusBadge, destIcon, destSub, destUri } from "./shared";

export function DestinationRow({
  dest,
  first,
  onEdit,
}: {
  dest: Destination;
  first: boolean;
  onEdit: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const DIcon = destIcon(dest.type);

  // `usedBytes` is computed; `maxStorageGb` (if set) lives in config.
  const usedGB = dest.usedBytes / 1e9;
  const maxRaw = (dest.config as Record<string, unknown>)?.maxStorageGb;
  const totalGB = typeof maxRaw === "number" ? maxRaw : undefined;
  const pct = totalGB ? (usedGB / totalGB) * 100 : null;

  const test = () => {
    setBusy(true);
    testDestination(dest.id)
      .then((res) => toast.success(res.message))
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Test failed"),
      )
      .finally(() => setBusy(false));
  };

  const remove = () => {
    const tx = destinationsCollection.delete(dest.id);
    tx.isPersisted.promise
      .then(() => toast.success("Destination removed"))
      .catch((err: unknown) =>
        toast.error(
          err instanceof Error ? err.message : "Couldn't remove destination",
        ),
      );
  };

  return (
    <div className={cn("flex items-center gap-3 px-4 py-3.5", !first && "border-t")}>
      <div className="grid size-8 place-items-center rounded-md border bg-muted/30 text-muted-foreground">
        <HugeiconsIcon icon={DIcon} className="size-3.5" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{dest.name}</span>
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
            {destUri(dest)}
          </span>
        </div>
        <div className="text-[11px] text-muted-foreground">{destSub(dest)}</div>
      </div>
      <div className="flex min-w-40 flex-col items-end gap-0.5">
        <span className="font-mono text-xs">
          {usedGB.toFixed(usedGB >= 10 ? 0 : 1)} GB
          {totalGB ? (
            <span className="text-muted-foreground"> / {totalGB} GB</span>
          ) : null}
        </span>
        {pct != null && (
          <div className="mt-1 h-1 w-36 rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full",
                pct > 80 ? "bg-amber-500" : "bg-foreground/60",
              )}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
        )}
      </div>
      <StatusBadge status={dest.status} />
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5"
        title="Validate stored credential"
        disabled={busy}
        onClick={test}
      >
        <HugeiconsIcon icon={Tick02Icon} className="size-3.5" />
        Test
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        title="Edit"
        onClick={onEdit}
      >
        <HugeiconsIcon icon={Settings01Icon} className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        title="Delete"
        onClick={remove}
      >
        <HugeiconsIcon icon={Delete02Icon} className="size-3.5" />
      </Button>
    </div>
  );
}
