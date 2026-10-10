/**
 * Remove a server from the org.
 *
 * `server.delete` has always existed; nothing in the UI called it, so a server
 * added by mistake (or one whose provisioning failed) could only be cleared
 * by going into the database. Deleting the row does not touch the host: it
 * un-registers it here. The confirm text says so, because "delete server" reads
 * like it might wipe the machine.
 *
 * The local manager row is never deletable: it represents the control plane
 * itself, and removing it breaks the very install serving this page.
 */

import { useState } from "react";

import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";

import { serverCollection, type Server } from "@/features/servers/data/server";
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
import { orpc } from "@/shared/server/orpc";

/** The control plane's own row. Deleting it would orphan this install. */
function isControlPlaneRow(server: Server): boolean {
  return server.role === "manager" && (server.host === "127.0.0.1" || server.name === "localhost");
}

export function ServerDeleteButton({ server }: { server: Server }) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  if (isControlPlaneRow(server)) return null;

  const remove = () => {
    setDeleting(true);
    orpc.server.delete
      .call({ id: server.id })
      .then((result) => {
        serverCollection.utils.writeDelete(server.id);
        // Removing a machine silently changes where other things may run. Say
        // how many, because "schedulable again" is a real change of behaviour
        // for anything that was pinned here.
        toast.success(
          result.unpinnedResources > 0
            ? `${server.name} removed. ${result.unpinnedResources} pinned ${
                result.unpinnedResources === 1 ? "resource is" : "resources are"
              } now schedulable anywhere`
            : `${server.name} removed`,
        );
        setOpen(false);
      })
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : `Couldn't remove ${server.name}`);
      })
      .finally(() => setDeleting(false));
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground hover:text-destructive"
        title={`Remove ${server.name}`}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
      >
        <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-3.5" />
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent onClick={(event) => event.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {server.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This un-registers the host from this organization. The machine itself is left running
              and untouched. Nothing is uninstalled, and any workloads on it keep going until you
              drain them. You can add it back at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                remove();
              }}
            >
              {deleting ? "Removing…" : "Remove server"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
