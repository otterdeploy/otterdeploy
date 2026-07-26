/**
 * One destination in the destinations list: name + connection summary, storage
 * usage, status, and test/edit/delete affordances. Delete mutates the
 * collection optimistically; test is a one-shot validation.
 *
 * The platform-managed local destination is deliberately narrower: it always
 * exists so a fresh install can schedule a backup without inventing a host path,
 * so it offers no Delete — only Disable, and the server refuses even that while
 * it's the last active destination. See packages/api/src/backups/managed-destination.ts.
 */
import { useState } from "react";

import { Delete02Icon, Settings01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

import type { Destination } from "./data/destinations";

import { destinationsCollection, setDestinationEnabled, testDestination } from "./data/destinations";
import { StatusBadge, destIcon, destSub, destUri } from "./shared";

/** Name, connection summary, and the managed marker + its honesty note. */
function DestinationIdentity({ dest }: { dest: Destination }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">{dest.name}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
          {destUri(dest)}
        </span>
        {dest.managed && (
          <span
            className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
            title="Created and located by otterdeploy. Always available, so a backup can be scheduled without configuring storage first."
          >
            Managed
          </span>
        )}
      </div>
      <div className="text-[11px] text-muted-foreground">
        {dest.managed
          ? // Honesty over reassurance (PRODUCT.md): this copy exists so nobody
            // reads an always-present local destination as "I have backups".
            "On this host — fast restores, not disaster recovery. Add off-host storage for that."
          : destSub(dest)}
      </div>
    </div>
  );
}

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
      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : "Test failed"))
      .finally(() => setBusy(false));
  };

  const remove = () => {
    const tx = destinationsCollection.delete(dest.id);
    tx.isPersisted.promise
      .then(() => toast.success("Destination removed"))
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Couldn't remove destination"),
      );
  };

  const disabled = dest.status === "disabled";

  const toggleEnabled = () => {
    setBusy(true);
    setDestinationEnabled(dest.id, disabled)
      .then(() => toast.success(disabled ? "Destination enabled" : "Destination disabled"))
      .catch((err: unknown) =>
        // The server refuses to disable the last active destination — surfacing
        // its message verbatim explains why better than a generic failure.
        toast.error(err instanceof Error ? err.message : "Couldn't change destination"),
      )
      .finally(() => setBusy(false));
  };

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-3.5",
        !first && "border-t",
        // A disabled destination takes no new backups. Dimming it keeps that
        // legible at a glance without hiding the row, since its existing
        // snapshots are still restorable.
        disabled && "opacity-60",
      )}
    >
      <div className="grid size-8 place-items-center rounded-md border bg-muted/30 text-muted-foreground">
        <HugeiconsIcon icon={DIcon} className="size-3.5" />
      </div>
      <DestinationIdentity dest={dest} />
      <div className="flex min-w-40 flex-col items-end gap-0.5">
        <span className="font-mono text-xs">
          {usedGB.toFixed(usedGB >= 10 ? 0 : 1)} GB
          {totalGB ? <span className="text-muted-foreground"> / {totalGB} GB</span> : null}
        </span>
        {pct != null && (
          <div className="mt-1 h-1 w-36 rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full", pct > 80 ? "bg-amber-500" : "bg-foreground/60")}
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
        size="sm"
        disabled={busy}
        title={
          disabled
            ? "Resume sending backups here"
            : "Stop sending new backups here. Existing snapshots stay restorable."
        }
        onClick={toggleEnabled}
      >
        {disabled ? "Enable" : "Disable"}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        title={dest.managed ? "Rename" : "Edit"}
        onClick={onEdit}
      >
        <HugeiconsIcon icon={Settings01Icon} className="size-3.5" />
      </Button>
      {/* No delete for the managed destination — it must always exist, or the
          org is back to "configure storage before you can back anything up".
          Disable is the escape hatch. */}
      {!dest.managed && (
        <Button variant="ghost" size="icon" className="size-7" title="Delete" onClick={remove}>
          <HugeiconsIcon icon={Delete02Icon} className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
