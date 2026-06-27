import { useState } from "react";

import { useMutation } from "@tanstack/react-query";
import { TrashIcon } from "lucide-react";

import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { client } from "@/utils/orpc";

interface Props {
  projectId: string;
  resourceId: string;
  name: string;
  onDeleted: () => void;
}

export function SettingsTab({ projectId, resourceId, name, onDeleted }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: () => client.project.database.postgres.delete({ projectId, resourceId }),
    onSuccess: () => {
      setConfirmOpen(false);
      onDeleted();
    },
  });

  return (
    <div className="grid gap-6 p-4">
      <Field>
        <FieldLabel>Name</FieldLabel>
        <Input value={name} disabled />
        <p className="mt-1 text-[10px] text-muted-foreground">
          Renaming lands when the API gains an update endpoint.
        </p>
      </Field>

      <div className="grid gap-2 rounded-lg border border-destructive/30 p-4">
        <div className="text-sm font-medium text-destructive-foreground">Danger zone</div>
        <p className="text-xs text-muted-foreground">
          Deleting this database removes the Swarm service, the underlying volume, and any proxy
          routes pointing at it.
        </p>
        <Button variant="destructive" onClick={() => setConfirmOpen(true)} className="w-fit">
          <TrashIcon className="size-4" />
          Delete
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={(next) => setConfirmOpen(next)}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete database "{name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the Swarm service, its volume, and any associated proxy routes. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete database"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}
