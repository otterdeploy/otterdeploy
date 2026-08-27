/**
 * A registry as a compact card in the registries grid.
 *
 * ONE CARD FOR TWO THINGS. A stored credential and the GHCR entry derived from
 * the workspace's GitHub App are both drawn by {@link RegistryCardShell} at the
 * same size, in the same order, with the same footer. They differ in what they
 * SAY — a managed entry has nothing to test and nothing to rotate — not in how
 * they're built. Before this they were two hand-rolled shells that had drifted
 * apart, and read as two kinds of object in one list.
 *
 * WHAT'S ON THE FACE is the minimum that distinguishes one registry from
 * another at a glance: mark, name, the `user@host` line, and how many projects
 * push there. Everything else — auth type, when it was added, when it last
 * changed, what the registry is for — lives in the tooltip, because a card
 * that prints all of it is a paragraph, and a column of paragraphs is not
 * scannable.
 *
 * NO STATUS DOT FOR HEALTH, and no image or tag count. Connection health is an
 * on-demand `testConnection` probe, never stored, so a green dot claiming
 * "reachable" would be inventing a reading. Docker Registry v2 has no portable
 * repository listing (`_catalog` is optional; neither Docker Hub nor GHCR
 * serves it), so an image count can't be had honestly either. The dot here
 * means something we DO know: whether anything actually pushes here.
 *
 * Actions stay hidden until hover or keyboard focus, so a grid of registries
 * isn't three identical button clusters competing at rest.
 *
 * Delete relies on the API clearing any binding, so deletion never leaves a
 * dangling reference.
 */

import { useState } from "react";

import {
  Delete01Icon,
  FlashIcon,
  MoreHorizontalIcon,
  PencilEdit01Icon,
} from "@hugeicons/core-free-icons";
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
import { RegistryCardShell } from "./registry-card-shell";
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

  const used = registry.projectCount > 0;
  const edited = registry.updatedAt.getTime() !== registry.createdAt.getTime();

  return (
    <>
      <RegistryCardShell
        logo={
          <SvglLogo
            search={REGISTRY_KIND_META[kindForHost(registry.host)].brand}
            fallback={registry.host}
            size={18}
          />
        }
        title={registry.displayName}
        subtitle={`${registry.username}@${registry.host}`}
        tone={used ? "ok" : "idle"}
        stat={
          used ? (
            <>
              <span className="font-mono text-foreground tabular-nums">
                {registry.projectCount}
              </span>{" "}
              {t(registry.projectCount === 1 ? "registries.project" : "registries.projects")}
            </>
          ) : (
            <span className="text-amber-600 dark:text-amber-500">{t("registries.unused")}</span>
          )
        }
        detail={[
          { label: t("registries.detail.host"), value: registry.host, mono: true },
          { label: t("registries.detail.auth"), value: registry.authType },
          { label: t("registries.detail.username"), value: registry.username, mono: true },
          {
            label: t("registries.detail.projects"),
            value: String(registry.projectCount),
            mono: true,
          },
          { label: t("registries.detail.added"), value: formatRelative(registry.createdAt) },
          ...(edited
            ? [{ label: t("registries.detail.updated"), value: formatRelative(registry.updatedAt) }]
            : []),
        ]}
        note={used ? t("registries.noteUsed") : t("registries.noteUnused")}
        actions={
          <>
            <Button
              size="xs"
              variant="ghost"
              className="text-muted-foreground"
              onClick={runTest}
              disabled={testConnection.isPending}
              aria-label={`Test connection to ${registry.host}`}
            >
              <HugeiconsIcon icon={FlashIcon} strokeWidth={2} className="size-3" />
              {testConnection.isPending ? "Testing…" : "Test"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="text-muted-foreground"
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
          </>
        }
      />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("registries.removeConfirm")}</AlertDialogTitle>
            <AlertDialogDescription>
              {/* The count makes the blast radius concrete instead of hypothetical:
                  "2 projects" is a decision, "any projects" is a shrug. */}
              {used
                ? t("registries.removeBody", {
                    count: registry.projectCount,
                    host: registry.host,
                  })
                : t("registries.removeBodyUnused", { host: registry.host })}
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
    </>
  );
}
