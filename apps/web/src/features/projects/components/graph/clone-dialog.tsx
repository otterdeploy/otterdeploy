/**
 * Clone a set of resources, with the consequences shown before the copy exists.
 *
 * The selection starts as whatever the operator right-clicked, but the useful
 * unit is usually a set: an app and its database cloned together stay wired to
 * each other, while cloning the app alone leaves it pointing at the original's
 * database. That is a real, silent data hazard — the copy connects, works, and
 * writes to production — so the preview names every reference that will still
 * reach outside the selection, and ticking the referenced resource makes the
 * warning disappear because the problem actually went away.
 *
 * Clones land as drafts. Copying is not deploying.
 */

import { useState } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { toastMessage } from "@/shared/lib/errors";
import { orpc, queryClient } from "@/shared/server/orpc";

export interface CloneCandidate {
  resourceId: string;
  name: string;
  kind: "service" | "database" | "compose";
}

export function CloneDialog({
  projectId,
  candidates,
  initialSelection,
  open,
  onOpenChange,
}: {
  projectId: string;
  /** Every resource in the project that can be cloned. */
  candidates: CloneCandidate[];
  /** Pre-ticked ids — normally the node the menu was opened on. */
  initialSelection: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // The operator's ticks, or null while they haven't touched anything — in
  // which case the right-clicked node *is* the selection. Nothing watches
  // `initialSelection` for changes: the caller rebuilds it inline
  // (`[target.data.resourceId]`) inside a graph that polls every 5s, so
  // anything keyed to that prop would re-seed mid-decision and silently drop
  // ticks the operator had added. Tick the database, wait five seconds,
  // clone, and you get the app alone still wired to the original's database —
  // the exact hazard this dialog exists to catch.
  const [picked, setPicked] = useState<string[] | null>(null);
  const selected = picked ?? initialSelection;

  // Every close routes through here so the next open seeds itself from
  // whatever node its menu was opened on. Dropping the ticks as the dialog
  // leaves is free: the exit animation is 50ms.
  const handleOpenChange = (next: boolean) => {
    if (!next) setPicked(null);
    onOpenChange(next);
  };

  const previewQuery = useQuery({
    ...orpc.project.resource.clonePreview.queryOptions({
      input: { projectId, resourceIds: selected },
    }),
    enabled: open && selected.length > 0,
  });

  const cloneMut = useMutation({
    ...orpc.project.resource.clone.mutationOptions(),
    onSuccess: (result) => {
      handleOpenChange(false);
      void queryClient.invalidateQueries();
      if (result.failed.length > 0) {
        // Partial success is real and must not read as total success.
        toast.warning(
          `Cloned ${result.created.length} of ${result.created.length + result.failed.length}`,
          { description: result.failed.map((f) => `${f.sourceName}: ${f.reason}`).join("; ") },
        );
        return;
      }
      toast.success(
        `Cloned ${result.created.length} resource${result.created.length === 1 ? "" : "s"}`,
        { description: "The copies are drafts — deploy them when you're ready." },
      );
    },
    onError: (err) => toast.error(toastMessage(err, "Clone failed")),
  });

  const toggle = (resourceId: string) =>
    setPicked((prev) => {
      // First tick promotes the seed to a real selection; from then on the
      // prop is out of the picture entirely.
      const base = prev ?? initialSelection;
      return base.includes(resourceId)
        ? base.filter((id) => id !== resourceId)
        : [...base, resourceId];
    });

  const externalRefs = previewQuery.data?.externalRefs ?? [];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Clone resources</DialogTitle>
          <DialogDescription>
            Copies are created as drafts with their own volumes and fresh database credentials.
            Domains are not copied.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {candidates.map((c) => {
            const targetName = previewQuery.data?.names.find(
              (n) => n.sourceName === c.name,
            )?.targetName;
            return (
              <label
                key={c.resourceId}
                className="flex cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 hover:bg-muted/50"
              >
                <Checkbox
                  checked={selected.includes(c.resourceId)}
                  onCheckedChange={() => toggle(c.resourceId)}
                />
                <span className="text-[12px] text-foreground">{c.name}</span>
                <span className="text-[11px] text-muted-foreground">{c.kind}</span>
                {targetName && (
                  <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                    → {targetName}
                  </span>
                )}
              </label>
            );
          })}
        </div>

        {externalRefs.length > 0 && (
          <div className="rounded-sm border border-destructive/40 bg-destructive/5 p-2.5">
            <div className="text-[11px] font-medium text-destructive">
              {externalRefs.length === 1 ? "One copy" : `${externalRefs.length} copies`} will still
              point at the original
            </div>
            <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-muted-foreground">
              {externalRefs.map((r) => (
                <li key={`${r.fromName}:${r.envKey}`}>
                  {r.fromName}.{r.envKey} → {r.toName}
                </li>
              ))}
            </ul>
            <div className="mt-1.5 text-[11px] text-muted-foreground">
              These copies will read and write the original resource. Tick it above to clone it too.
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => cloneMut.mutate({ projectId, resourceIds: selected })}
            disabled={selected.length === 0 || cloneMut.isPending}
          >
            {cloneMut.isPending
              ? "Cloning…"
              : `Clone ${selected.length} resource${selected.length === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
