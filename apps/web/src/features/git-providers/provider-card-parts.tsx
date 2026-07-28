/**
 * Per-installation row bits for the git-provider cards — the repo-sync action
 * and the status pill.
 *
 * Split from ./provider-card on the repo's `-parts` convention so the card
 * file stays within the length budget. Moved verbatim; no behaviour change.
 */

import { RefreshIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { isDefinedError } from "@orpc/client";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";
import { orpc, queryClient } from "@/shared/server/orpc";

import type { InstallationView } from "./shared";

export function RefreshButton({
  installationId,
  onReinstall,
}: {
  installationId: string;
  onReinstall: () => void;
}) {
  const refresh = useMutation({
    ...orpc.git.refreshRepos.mutationOptions(),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({
        queryKey: orpc.git.list.queryKey({ input: undefined }),
      });
      toast.success(`Synced ${res.repoCount} repos`);
    },
    onError: (err) => {
      // A no-longer-valid installation is recoverable — put "Reinstall" right
      // in the toast so the failure isn't a dead end.
      const needsReinstall = isDefinedError(err) && err.code === "REINSTALL_REQUIRED";
      toast.error(
        err.message ?? "Sync failed",
        needsReinstall ? { action: { label: "Reinstall", onClick: onReinstall } } : undefined,
      );
    },
  });
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => refresh.mutate({ installationId })}
      disabled={refresh.isPending}
    >
      <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} />
      {refresh.isPending ? "Syncing…" : "Sync now"}
    </Button>
  );
}

export function StatusBadge({ installation }: { installation: InstallationView }) {
  const tone = installation.revokedAt
    ? "bg-destructive/15 text-destructive border-destructive/30"
    : installation.suspendedAt
      ? "bg-warning/15 text-warning border-warning/30"
      : "bg-success/15 text-success border-success/30";
  const label = installation.revokedAt
    ? "revoked"
    : installation.suspendedAt
      ? "suspended"
      : "active";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] tracking-wider uppercase",
        tone,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}
