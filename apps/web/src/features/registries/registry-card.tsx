/**
 * A single row in the registries list. Inline actions: edit (opens the
 * dialog pre-filled), delete (confirm + mutate). The delete handler
 * relies on the API setting `project.containerRegistryId := NULL` for
 * any projects pointing at the credential, so deletion never leaves
 * dangling FKs.
 */

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Database02Icon,
  Delete01Icon,
  PencilEdit01Icon,
} from "@hugeicons/core-free-icons";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog";
import { Button } from "@/shared/components/ui/button";

import { registryCollection } from "./data/registries";
import { formatRelative, type RegistryRow } from "./shared";

interface RegistryCardProps {
  registry: RegistryRow;
  onEdit: (r: RegistryRow) => void;
}

export function RegistryCard({ registry, onEdit }: RegistryCardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Optimistic delete: the collection drops the row locally and fires
  // `registry.delete` via `onDelete`; TanStack DB rolls back on reject.
  const remove = () => {
    setBusy(true);
    const tx = registryCollection.delete(registry.id);
    tx.isPersisted.promise
      .then(() => {
        toast.success("Registry removed");
        setConfirmOpen(false);
      })
      .catch((err: unknown) =>
        toast.error(
          err instanceof Error ? err.message : "Failed to remove registry",
        ),
      )
      .finally(() => setBusy(false));
  };

  return (
    <div className="rounded-md border bg-card p-4">
      <div className="flex items-start gap-3">
        <div className="grid size-8 shrink-0 place-items-center rounded-md bg-muted">
          <HugeiconsIcon
            icon={Database02Icon}
            strokeWidth={2}
            className="size-4 text-muted-foreground"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13.5px] font-semibold">
              {registry.displayName}
            </span>
            <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
              {registry.authType}
            </span>
          </div>
          <div className="mt-0.5 font-mono text-[11.5px] text-muted-foreground">
            {registry.username}@{registry.host}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onEdit(registry)}
            aria-label="Edit registry"
          >
            <HugeiconsIcon icon={PencilEdit01Icon} strokeWidth={2} className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setConfirmOpen(true)}
            aria-label="Delete registry"
          >
            <HugeiconsIcon icon={Delete01Icon} strokeWidth={2} className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="mt-3.5 flex items-center gap-6 border-t pt-3 text-[12px] text-muted-foreground">
        <span>Added {formatRelative(registry.createdAt)}</span>
        {registry.updatedAt.getTime() !== registry.createdAt.getTime() && (
          <span>Updated {formatRelative(registry.updatedAt)}</span>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this registry?</AlertDialogTitle>
            <AlertDialogDescription>
              Any projects pointing at <span className="font-mono">{registry.host}</span>{" "}
              via this credential will have their registry binding cleared.
              Builds for those projects will fail until a new credential is wired
              up.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                remove();
              }}
              disabled={busy}
            >
              {busy ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
