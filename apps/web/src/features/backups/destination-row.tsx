/**
 * One destination in the destinations list: name + connection summary, storage
 * usage, status, and test/edit/delete affordances. Delete mutates the
 * collection optimistically; test is a one-shot validation.
 *
 * The platform-managed local destination is deliberately narrower: it always
 * exists so a fresh install can schedule a backup without inventing a host path,
 * so it offers no Delete. Only Disable, and the server refuses even that while
 * it's the last active destination. See packages/api/src/backups/managed-destination.ts.
 *
 * A row with `usedForBackups: false` is a bucket connected in the workbench:
 * the same table, the same stored credential, but not a backup target. It
 * shows here — this is where you would come looking — reading as what it is,
 * and "Use for backups" is the explicit act that turns it into one.
 */
import { useState } from "react";

import { Delete02Icon, Settings01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

import type { Destination } from "./data/destinations";

import {
  destinationsCollection,
  setDestinationEnabled,
  setDestinationUsedForBackups,
  testDestination,
} from "./data/destinations";
import { StatusBadge, destIcon, destSub, destUri } from "./shared";

/** Name, connection summary, and the managed marker + its honesty note. */
function DestinationIdentity({ dest }: { dest: Destination }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-semibold">{dest.name}</span>
        {dest.managed && (
          <span
            className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
            title="Created and located by otterdeploy. Always available, so a backup can be scheduled without configuring storage first."
          >
            Managed
          </span>
        )}
      </div>
      {/* The URI gets its own line and TRUNCATES rather than wrapping: it is a
          single unbreakable token (a bucket URL, an absolute host path), and
          wrapping turned it into a two-line filled slab that outweighed the
          destination's own name. The full value stays available on hover and
          in the editor. */}
      <span
        className="block truncate font-mono text-[11px] text-muted-foreground"
        title={destUri(dest)}
      >
        {destUri(dest)}
      </span>
      <div className="text-[11px] text-muted-foreground">
        {dest.managed
          ? // Honesty over reassurance (PRODUCT.md): this copy exists so nobody
            // reads an always-present local destination as "I have backups".
            "On this host: fast restores, not disaster recovery. Add off-host storage for that."
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
  const maxRaw = dest.config.maxStorageGb;
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
  // Not a backup target at all — a connected bucket. Distinct from `disabled`,
  // which is a backup destination the operator has paused.
  const browseOnly = !dest.usedForBackups;

  /** Both flag flips answer the same way, so they report the same way. The
   *  server's own message is surfaced verbatim on failure: it refuses to turn
   *  off the last usable destination and says why, which beats a generic one. */
  const flip = (pending: Promise<unknown>, ok: string) => {
    setBusy(true);
    pending
      .then(() => toast.success(ok))
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Couldn't change destination"),
      )
      .finally(() => setBusy(false));
  };

  const toggleUsedForBackups = () =>
    flip(
      setDestinationUsedForBackups(dest.id, browseOnly),
      browseOnly ? "Backups can now be written here" : "No longer a backup target",
    );

  const toggleEnabled = () =>
    flip(
      setDestinationEnabled(dest.id, disabled),
      disabled ? "Destination enabled" : "Destination disabled",
    );

  return (
    <div
      className={cn(
        // One line from `lg`; below it the identity, the usage read-out and
        // the four controls each take their own row. Six items on one line is
        // ~700px of content in a 358px card.
        "flex flex-col gap-3 px-4 py-3.5 lg:flex-row lg:items-center",
        !first && "border-t",
        // A disabled destination takes no new backups. Dimming it keeps that
        // legible at a glance without hiding the row, since its existing
        // snapshots are still restorable.
        (disabled || browseOnly) && "opacity-60",
      )}
    >
      {/* Each wrapper is a mobile row and `display:contents` from `lg`, so the
          same children become direct flex items of the one-line desktop row. */}
      <div className="flex min-w-0 items-start gap-3 lg:contents">
        <div className="grid size-8 shrink-0 place-items-center rounded-md border bg-muted/30 text-muted-foreground">
          <HugeiconsIcon icon={DIcon} className="size-3.5" />
        </div>
        <DestinationIdentity dest={dest} />
      </div>

      {/* pl-11 = the 32px icon + 12px gap above it, so every stacked row hangs
          off the SAME left edge as the destination's name instead of starting
          under the icon. Dropped at `lg`, where these become flex items of the
          one-line row. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pl-11 lg:contents">
        <div className="flex flex-col items-start gap-0.5 lg:min-w-40 lg:items-end">
          <span className="font-mono text-xs">
            {usedGB.toFixed(usedGB >= 10 ? 0 : 1)} GB
            {totalGB ? <span className="text-muted-foreground"> / {totalGB} GB</span> : null}
          </span>
          {pct != null && (
            <div className="mt-1 h-1 w-36 rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full", pct > 80 ? "bg-warning" : "bg-foreground/60")}
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>
          )}
        </div>
        {/* Fixed column from `lg`: "Active" and "Disabled" differ in width and
            would otherwise nudge every control after them. */}
        <div className="lg:w-24">
          {browseOnly ? (
            <span
              className="rounded bg-muted px-1.5 py-0.5 text-[11px] whitespace-nowrap text-muted-foreground"
              title="Connected so you can browse it. Nothing is backed up here."
            >
              Browse only
            </span>
          ) : (
            <StatusBadge status={dest.status} />
          )}
        </div>
      </div>

      <DestinationControls
        managed={dest.managed}
        busy={busy}
        disabled={disabled}
        browseOnly={browseOnly}
        onTest={test}
        onToggleEnabled={toggleEnabled}
        onToggleUsedForBackups={toggleUsedForBackups}
        onEdit={onEdit}
        onRemove={remove}
      />
    </div>
  );
}

/**
 * Test / enable / opt-in / edit / delete.
 *
 * Its own component because every one of the row's conditions lands here —
 * managed or not, disabled or not, a backup target or a browse-only bucket —
 * and reading the row's layout should not mean reading five buttons' branches
 * first.
 */
function DestinationControls({
  managed,
  busy,
  disabled,
  browseOnly,
  onTest,
  onToggleEnabled,
  onToggleUsedForBackups,
  onEdit,
  onRemove,
}: {
  managed: boolean;
  busy: boolean;
  disabled: boolean;
  browseOnly: boolean;
  onTest: () => void;
  onToggleEnabled: () => void;
  onToggleUsedForBackups: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    /* pl-9, not pl-11: these are ghost buttons whose own px-2.5 padding
       carries the rest of the way, so their LABELS line up with the name
       rather than their invisible box edges. */
    <div className="flex flex-wrap items-center gap-1 pl-9 lg:contents lg:pl-0">
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5"
        title="Validate stored credential"
        disabled={busy}
        onClick={onTest}
      >
        <HugeiconsIcon icon={Tick02Icon} className="size-3.5" />
        Test
      </Button>
      {browseOnly ? (
        // The explicit act. A connected bucket is inert until this is
        // clicked; no schedule can name it before then.
        <Button
          variant="ghost"
          size="sm"
          className="whitespace-nowrap"
          disabled={busy}
          title="Start writing backups into this bucket. Nothing is written until you do."
          onClick={onToggleUsedForBackups}
        >
          Use for backups
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          // Widest label ("Disable") sets the column so Enable/Disable rows align.
          className="lg:w-[76px]"
          disabled={busy}
          title={
            disabled
              ? "Resume sending backups here"
              : "Stop sending new backups here. Existing snapshots stay restorable."
          }
          onClick={onToggleEnabled}
        >
          {disabled ? "Enable" : "Disable"}
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        title={managed ? "Rename" : "Edit"}
        onClick={onEdit}
      >
        <HugeiconsIcon icon={Settings01Icon} className="size-3.5" />
      </Button>
      {/* No delete for the managed destination. It must always exist, or the
            org is back to "configure storage before you can back anything up".
            Disable is the escape hatch. */}
      {managed ? (
        // Same footprint as the delete button so the managed row's controls
        // sit in the same columns as every other row's, rather than the
        // whole tail sliding one icon to the right.
        <span aria-hidden className="hidden size-7 lg:block" />
      ) : (
        <Button variant="ghost" size="icon" className="size-7" title="Delete" onClick={onRemove}>
          <HugeiconsIcon icon={Delete02Icon} className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
