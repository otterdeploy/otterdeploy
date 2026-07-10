/**
 * One row of the API keys table: masked prefix, scopes, usage/expiry, the
 * enable toggle and rotate/delete affordances (owners/admins only). Mutations
 * go straight to `apiKeysCollection` — optimistic, with the rollback/toast
 * handled off the transaction's `isPersisted` promise.
 *
 * Rotation note: the better-auth api-key plugin (1.6.x) has no rotate
 * endpoint (`/api-key/{create,get,list,update,delete}` only), so rotate is
 * create-then-delete — a replacement key with the same name/scopes/expiry is
 * minted first, and the old key is deleted only after the new one persists.
 * Not atomic: if the delete fails both keys are briefly live, and we say so.
 */

import { useState } from "react";

import { Delete02Icon, RefreshIcon } from "@hugeicons/core-free-icons";
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
  onRotated,
}: {
  apiKey: (typeof apiKeysCollection.toArray)[number];
  canManage: boolean;
  /** Receives the replacement key's one-time plaintext token after a rotate. */
  onRotated: (key: string) => void;
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

  // Create-then-delete rotation (no rotate endpoint in the plugin — see the
  // file header). The replacement inherits name/scopes and the SAME absolute
  // expiresAt, so a "90 days" key rotated on day 30 still dies on day 90.
  const rotate = () => {
    setBusy(true);
    let plaintext: string | null = null;
    const insertTx = apiKeysCollection.insert(
      {
        id: crypto.randomUUID(),
        organizationId: apiKey.organizationId,
        name: apiKey.name,
        start: null,
        prefix: null,
        enabled: true,
        expiresAt: apiKey.expiresAt,
        lastRequest: null,
        createdAt: new Date(),
        permissions: apiKey.permissions,
      },
      {
        metadata: {
          onKey: (k: string) => {
            plaintext = k;
          },
        },
      },
    );
    insertTx.isPersisted.promise
      .then(() => {
        // Reveal the new secret immediately — it must not be lost even if the
        // old-key cleanup below fails.
        if (plaintext) onRotated(plaintext);
        const deleteTx = apiKeysCollection.delete(apiKey.id);
        return deleteTx.isPersisted.promise
          .then(() => toast.success(`Rotated "${apiKey.name ?? "key"}" — old key revoked`))
          .catch(() =>
            toast.error(
              "Replacement key created, but the old key couldn't be deleted — it is still active. Delete it manually.",
            ),
          );
      })
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Failed to rotate key"),
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
          <div className="flex items-center justify-end gap-0.5">
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
                  <AlertDialogTitle>Rotate “{apiKey.name ?? "this key"}”?</AlertDialogTitle>
                  <AlertDialogDescription>
                    A replacement key is created with the same name, scopes and expiry, and this key
                    is revoked once it succeeds. Clients using the current key will lose access —
                    you'll see the new key once, right after.
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
                      <Button size="sm" disabled={busy} onClick={rotate}>
                        Rotate key
                      </Button>
                    }
                  />
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
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
          </div>
        </TableCell>
      ) : null}
    </TableRow>
  );
}
