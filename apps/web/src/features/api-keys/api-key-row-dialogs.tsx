/**
 * The rotate / delete confirm dialogs for one API-key row, each with its own
 * icon-button trigger. Pure confirmation UI — the mutations stay in
 * `ApiKeyRow` (see its header for the create-then-delete rotation caveat) and
 * arrive here as `onConfirm`.
 */

import { Delete02Icon, RefreshIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/shared/components/ui/alert-dialog";
import { Button } from "@/shared/components/ui/button";

export function RotateKeyDialog({
  name,
  busy,
  expired,
  onConfirm,
}: {
  name: string | null;
  busy: boolean;
  expired: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground"
            aria-label="Rotate API key"
            disabled={busy || expired}
          >
            <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} className="size-3.5" />
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Rotate “{name ?? "this key"}”?</AlertDialogTitle>
          <AlertDialogDescription>
            A replacement key is created with the same name, scopes and expiry, and this key is
            revoked once it succeeds. Clients using the current key will lose access — you'll see
            the new key once, right after.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            render={
              <Button variant="outline" size="sm">
                Cancel
              </Button>
            }
          />
          <AlertDialogAction
            render={
              <Button size="sm" disabled={busy} onClick={onConfirm}>
                Rotate key
              </Button>
            }
          />
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function DeleteKeyDialog({
  name,
  busy,
  onConfirm,
}: {
  name: string | null;
  busy: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-destructive"
            aria-label="Delete API key"
          >
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-3.5" />
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{name ?? "this key"}”?</AlertDialogTitle>
          <AlertDialogDescription>
            Any client still using this key will immediately lose access. This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            render={
              <Button variant="outline" size="sm">
                Cancel
              </Button>
            }
          />
          <AlertDialogAction
            render={
              <Button variant="destructive" size="sm" disabled={busy} onClick={onConfirm}>
                Delete
              </Button>
            }
          />
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
