/**
 * One row of the API keys table: masked prefix, scopes, usage/expiry, and the
 * enable toggle + delete affordance (owners/admins only). Mutations go straight
 * to `apiKeysCollection` — optimistic, with the rollback/toast handled off the
 * transaction's `isPersisted` promise.
 */

import { useState } from "react";

import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
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
  AlertDialogTrigger,
} from "@/shared/components/ui/alert-dialog";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Switch } from "@/shared/components/ui/switch";
import { TableCell, TableRow } from "@/shared/components/ui/table";

import { apiKeysCollection } from "./data/api-keys";
import { formatDate, isExpired } from "./shared";

export function ApiKeyRow({
  apiKey,
  canManage,
}: {
  apiKey: (typeof apiKeysCollection.toArray)[number];
  canManage: boolean;
}) {
  const [busy, setBusy] = useState(false);

  const scopes = apiKey.permissions ? Object.keys(apiKey.permissions) : [];
  const expired = isExpired(apiKey.expiresAt);

  // Optimistic toggle: the collection flips the row locally and fires
  // `authClient.apiKey.update` via `onUpdate`; TanStack DB rolls back on reject.
  const toggleEnabled = (checked: boolean) => {
    setBusy(true);
    const tx = apiKeysCollection.update(apiKey.id, (draft) => {
      draft.enabled = checked;
    });
    tx.isPersisted.promise
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Failed to update key"),
      )
      .finally(() => setBusy(false));
  };

  const remove = () => {
    setBusy(true);
    const tx = apiKeysCollection.delete(apiKey.id);
    tx.isPersisted.promise
      .then(() => toast.success("API key deleted"))
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Failed to delete key"),
      )
      .finally(() => setBusy(false));
  };

  return (
    <TableRow className={apiKey.enabled ? undefined : "opacity-60"}>
      <TableCell className="font-medium">
        {apiKey.name ?? "Untitled key"}
        <div className="text-[11px] font-normal text-muted-foreground">
          Created {formatDate(apiKey.createdAt)}
        </div>
      </TableCell>
      <TableCell>
        <code className="font-mono text-[12px] text-muted-foreground">
          {apiKey.start ? `${apiKey.start}…` : "—"}
        </code>
      </TableCell>
      <TableCell>
        {scopes.length === 0 ? (
          <span className="text-[12px] text-muted-foreground">Full access</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {scopes.map((s) => (
              <Badge key={s} variant="outline" className="text-[11px]">
                {s}
              </Badge>
            ))}
          </div>
        )}
      </TableCell>
      <TableCell className="text-[12px] text-muted-foreground">
        {formatDate(apiKey.lastRequest, "Never")}
      </TableCell>
      <TableCell className="text-[12px]">
        {expired ? (
          <Badge variant="destructive" className="text-[11px]">
            Expired
          </Badge>
        ) : (
          <span className="text-muted-foreground">{formatDate(apiKey.expiresAt, "Never")}</span>
        )}
      </TableCell>
      <TableCell className="text-right">
        <Switch
          checked={apiKey.enabled}
          disabled={!canManage || busy}
          onCheckedChange={toggleEnabled}
        />
      </TableCell>
      {canManage ? (
        <TableCell>
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
                <AlertDialogTitle>Delete “{apiKey.name ?? "this key"}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  Any client still using this key will immediately lose access. This can't be
                  undone.
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
                    <Button variant="destructive" size="sm" disabled={busy} onClick={remove}>
                      Delete
                    </Button>
                  }
                />
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </TableCell>
      ) : null}
    </TableRow>
  );
}
