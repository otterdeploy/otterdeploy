/**
 * A stored registry credential as a compact grid card, on the same vocabulary
 * as a project card (features/projects/components/project-card.tsx) and a
 * notification channel card: `rounded-xl border bg-card p-4`, identity block,
 * hairline-divided footer, dropped into the same
 * `md:grid-cols-2 xl:grid-cols-3` grid.
 *
 * It was a full-bleed row. A registry has a name, a host, a username and two
 * timestamps to its name — roughly eighty characters — and stretching that
 * across a 1960px page put the action cluster about 1800px from the name it
 * belonged to, with a corridor of nothing in between. Cards give the content
 * the width it actually needs and use the horizontal room for more registries
 * instead of more gap.
 *
 * Unlike a project or channel card there is NO preview block, because there is
 * nothing honest to preview: connection health is an on-demand `testConnection`
 * probe, not stored state, so a status dot here would be inventing a reading
 * the product does not have. The card says what it knows and no more.
 *
 * Actions carry a hierarchy rather than three identical outlines: Test is the
 * one thing you press to answer "does this credential still work", so it keeps
 * the outline; edit and delete fold into an overflow menu, which also stops
 * delete from sitting at the same weight as edit.
 *
 * Delete relies on the API setting `project.containerRegistryId := NULL` for
 * any projects pointing at the credential, so deletion never leaves dangling
 * FKs.
 */

import { useState } from "react";

import { Delete01Icon, MoreHorizontalIcon, PencilEdit01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { SvglLogo } from "@/shared/components/brand/svgl-logo";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { orpc } from "@/shared/server/orpc";

import { registryCollection } from "./data/registries";
import { RegistryCardShell, RegistryCardFooter } from "./registry-card-shell";
import { REGISTRY_KIND_META, kindForHost } from "./registry-kinds";
import { formatRelative, type RegistryRow } from "./shared";

interface RegistryCardProps {
  registry: RegistryRow;
  onEdit: (r: RegistryRow) => void;
}

export function RegistryCard({ registry, onEdit }: RegistryCardProps) {
  const { t } = useTranslation();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Docker v2 handshake against the stored credential. Failed probes come
  // back as `{ok: false, message}` (not thrown), so both toast branches
  // carry the server's honest message.
  const testConnection = useMutation(orpc.registry.testConnection.mutationOptions());
  const runTest = () => {
    testConnection.mutate(
      { id: registry.id },
      {
        onSuccess: (res) => (res.ok ? toast.success(res.message) : toast.error(res.message)),
        onError: (err: unknown) =>
          toast.error(err instanceof Error ? err.message : "Connection test failed"),
      },
    );
  };

  // Optimistic delete: the collection drops the row locally and fires
  // `registry.delete` via `onDelete`; TanStack DB rolls back on reject.
  const remove = () => {
    setBusy(true);
    const tx = registryCollection.delete(registry.id);
    tx.isPersisted.promise
      .then(() => {
        toast.success(t("registries.removed"));
        setConfirmOpen(false);
      })
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Failed to remove registry"),
      )
      .finally(() => setBusy(false));
  };

  const edited = registry.updatedAt.getTime() !== registry.createdAt.getTime();

  return (
    <RegistryCardShell
      logo={
        <SvglLogo
          search={REGISTRY_KIND_META[kindForHost(registry.host)].brand}
          fallback={registry.host}
          size={20}
        />
      }
      title={registry.displayName}
      badge={registry.authType}
      subtitle={`${registry.username}@${registry.host}`}
      action={
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size="icon-sm"
                variant="ghost"
                className="-mt-1 -mr-1 text-muted-foreground"
                aria-label={t("common.more")}
              />
            }
          >
            <HugeiconsIcon icon={MoreHorizontalIcon} strokeWidth={2} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={() => onEdit(registry)}>
              <HugeiconsIcon icon={PencilEdit01Icon} strokeWidth={2} />
              {t("registries.edit")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => setConfirmOpen(true)}
            >
              <HugeiconsIcon icon={Delete01Icon} strokeWidth={2} />
              {t("registries.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      <RegistryCardFooter
        meta={
          <>
            <span>Added {formatRelative(registry.createdAt)}</span>
            {edited && <span>Updated {formatRelative(registry.updatedAt)}</span>}
          </>
        }
      >
        <Button
          size="xs"
          variant="outline"
          onClick={runTest}
          disabled={testConnection.isPending}
          aria-label={`Test connection to ${registry.host}`}
        >
          {testConnection.isPending ? "Testing…" : "Test"}
        </Button>
      </RegistryCardFooter>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("registries.removeConfirm")}</AlertDialogTitle>
            <AlertDialogDescription>
              Any projects pointing at <span className="font-mono">{registry.host}</span> via this
              credential will have their registry binding cleared. Builds for those projects will
              fail until a new credential is wired up.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("common.cancel")}</AlertDialogCancel>
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
    </RegistryCardShell>
  );
}
