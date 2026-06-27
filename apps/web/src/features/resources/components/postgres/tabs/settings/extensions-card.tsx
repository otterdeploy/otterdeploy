/**
 * Toggle Postgres extensions on an existing database. Calls
 * `project.resource.database.postgres.setExtensions` — the backend persists
 * the full set, rolls the service (the image changes for non-contrib
 * extensions like pgvector / postgis), then runs CREATE / DROP EXTENSION
 * against the live database.
 *
 * Non-contrib extensions each pin a specific image, so two that need
 * different images can't be enabled together. We detect that locally with
 * the shared resolver and block the toggle with a toast before it ever
 * reaches the server.
 */

import { useState } from "react";

import { POSTGRES_EXTENSIONS, resolvePostgresImage } from "@otterdeploy/shared/postgres-extensions";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { useStageManifestChange } from "@/features/projects/hooks/use-manifest-stage";
import { SettingsCard } from "@/features/resources/components/_shared/settings-card";
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
import { Switch } from "@/shared/components/ui/switch";
import { orpc, queryClient } from "@/shared/server/orpc";

import type { PostgresBodyProps } from "../../types";

export function ExtensionsCard({
  resource,
  pending = false,
  dbName,
}: {
  resource: PostgresBodyProps["resource"];
  // Pending-create mode: no resource row yet, so toggles stage onto the
  // manifest entry (`databases[dbName].extensions`) instead of the live API.
  // There's no running image to swap, so the swap-confirm dialog is skipped.
  pending?: boolean;
  dbName?: string;
}) {
  const enabled = resource.extensions ?? [];

  // A non-contrib toggle awaiting confirmation — it swaps the database image
  // and redeploys, so we make the user click through before committing.
  const [pendingSwap, setPendingSwap] = useState<{
    name: string;
    label: string;
    on: boolean;
  } | null>(null);

  const setExtensions = useMutation({
    ...orpc.project.resource.database.postgres.setExtensions.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.project.resource.list.queryKey({
          input: { projectId: resource.projectId as never },
        }),
      });
      toast.success("Extensions updated");
    },
    onError: (err) => toast.error(err.message ?? "Failed to update extensions"),
  });

  const stage = useStageManifestChange(resource.projectId as never, {
    successToast: "Extensions staged — Deploy to apply",
  });

  // Contrib extensions enable live; non-contrib ones swap the image and need
  // explicit confirmation first. Pending stacks never run, so nothing to swap —
  // every toggle stages immediately.
  const requestToggle = (ext: (typeof POSTGRES_EXTENSIONS)[number], on: boolean) => {
    if (pending || ext.contrib) {
      apply(ext.name, on);
      return;
    }
    setPendingSwap({ name: ext.name, label: ext.label, on });
  };

  const apply = (name: string, on: boolean) => {
    const next = on ? [...enabled, name] : enabled.filter((e) => e !== name);

    // Block incompatible image combinations before the round-trip — the
    // server would reject them too, but this is instant and specific.
    // `defaultImage` is irrelevant to the conflict check, so any string works.
    const resolved = resolvePostgresImage(next, "postgres");
    if (!resolved.ok) {
      toast.error(
        `Can't combine these extensions — they need different images: ${resolved.conflict.join(", ")}`,
      );
      return;
    }

    if (pending && dbName) {
      void stage.mutateAsync((m) => {
        const db = m.databases[dbName];
        if (!db || db.engine !== "postgres") return m;
        return {
          ...m,
          databases: { ...m.databases, [dbName]: { ...db, extensions: next } },
        };
      });
      return;
    }

    setExtensions.mutate({
      projectId: resource.projectId as never,
      resourceId: resource.resourceId as never,
      extensions: next,
    });
  };

  const busy = pending ? stage.isPending : setExtensions.isPending;

  return (
    <SettingsCard
      title="Extensions"
      description="Contrib extensions enable live with ~0 downtime. pgvector / PostGIS / TimescaleDB swap the database image and redeploy (~5–10s) before enabling."
    >
      {POSTGRES_EXTENSIONS.map((ext) => {
        const isOn = enabled.includes(ext.name);
        return (
          <div
            key={ext.name}
            className="flex items-center justify-between gap-3 border-b border-border/40 px-3 py-2.5 last:border-b-0"
          >
            <div className="flex min-w-0 flex-col">
              <span className="flex items-center gap-2 text-[13px] font-medium">
                {ext.label}
                {!ext.contrib && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[9.5px] font-semibold tracking-wide text-muted-foreground uppercase">
                    image swap
                  </span>
                )}
              </span>
              <span className="truncate text-[11px] text-muted-foreground">{ext.description}</span>
            </div>
            <Switch
              checked={isOn}
              disabled={busy}
              onCheckedChange={(next) => requestToggle(ext, next)}
            />
          </div>
        );
      })}

      <AlertDialog
        open={pendingSwap !== null}
        onOpenChange={(open) => {
          if (!open) setPendingSwap(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingSwap?.on ? "Enable" : "Disable"} {pendingSwap?.label}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingSwap?.label} {pendingSwap?.on ? "requires" : "ran on"} a different database
              image. {pendingSwap?.on ? "Enabling" : "Disabling"} it swaps the image and redeploys
              the database (~5–10s of downtime). Existing data is preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              render={
                <Button variant="outline" size="sm" disabled={busy}>
                  Cancel
                </Button>
              }
            />
            <AlertDialogAction
              size="sm"
              onClick={() => {
                if (pendingSwap) {
                  apply(pendingSwap.name, pendingSwap.on);
                  setPendingSwap(null);
                }
              }}
            >
              {pendingSwap?.on ? "Swap & enable" : "Swap & disable"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsCard>
  );
}
