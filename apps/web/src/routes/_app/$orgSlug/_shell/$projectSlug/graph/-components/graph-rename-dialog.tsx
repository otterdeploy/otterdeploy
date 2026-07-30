/**
 * Rename a PENDING resource from the graph's context menu.
 *
 * Only offered for resources that have never been created. A deployed one has
 * its container, swarm service and volume names derived from its name, so
 * renaming the manifest key would repoint the project at infrastructure that
 * doesn't exist — the server refuses it, and the menu doesn't offer it.
 *
 * The rename itself is a manifest edit: the key moves and every
 * `${service:old.…}` / `${database:old.…}` ref that addressed it is rewritten
 * in the same write (see routers/project/manifest-rename.ts). Nothing deploys.
 *
 * Rendered by GraphCanvas as a SIBLING of the menu — the DropdownMenu unmounts
 * the moment the item is clicked, so a dialog nested inside would go with it.
 * Same target-driven shape as graph-node-delete.tsx.
 */

import { useState } from "react";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import type { ProjectId } from "@otterdeploy/shared/id";

import type { ResourceFlowNode } from "@/features/projects/components/graph/resource-node-types";

import { invalidateManifestConsumers } from "@/features/projects/hooks/use-manifest-stage";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { toastMessage } from "@/shared/lib/errors";
import { orpc } from "@/shared/server/orpc";

/** The manifest's key grammar, minus the trailing hyphen it wrongly allows —
 *  `mariadb-` sanitizes to `mariadb` when Docker names are derived, which
 *  collides with a real `mariadb` and fails the create forever. */
function nameIssue(value: string): string | null {
  const name = value.trim();
  if (!name) return null;
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    return "Lowercase letters, digits and hyphens; start with a letter.";
  }
  if (name.endsWith("-")) return "Can't end with a hyphen.";
  if (name.length > 63) return "Too long (max 63 characters).";
  return null;
}

export function GraphRenameDialog({
  target,
  projectId,
  onClose,
}: {
  target: ResourceFlowNode | null;
  projectId: ProjectId | null;
  onClose: () => void;
}) {
  const from = target?.data.name ?? "";
  const [value, setValue] = useState("");
  const kind = target?.data.kind;

  const rename = useMutation({
    mutationFn: (to: string) =>
      orpc.project.manifest.rename.call({
        projectId: projectId as ProjectId,
        // The menu only offers this for the three named kinds.
        resource: kind as "service" | "database" | "compose",
        from,
        to,
      }),
    onSuccess: async (_res, to) => {
      toast.success(`Renamed to ${to}`);
      await invalidateManifestConsumers(projectId as ProjectId);
      onClose();
    },
    onError: (err) => toast.error(toastMessage(err, "Rename failed")),
  });

  const next = value.trim();
  const issue = nameIssue(value);
  const unchanged = next === from;
  const canSubmit = next.length > 0 && !issue && !unchanged && !rename.isPending;

  return (
    <Dialog
      open={target !== null && projectId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename {from}</DialogTitle>
          <DialogDescription>
            Updates the manifest and every variable that references this{" "}
            {kind === "database" ? "database" : kind === "compose" ? "stack" : "service"}. Nothing
            is deployed until you Apply.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) rename.mutate(next);
          }}
        >
          <Input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={from}
            aria-invalid={issue !== null}
            className="font-mono"
          />
          <span className="min-h-4 text-[11px] text-destructive">{issue ?? ""}</span>

          <DialogFooter className="mt-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!canSubmit}>
              {rename.isPending ? "Renaming…" : "Rename"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
