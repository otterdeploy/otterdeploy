/**
 * Floating "Apply N change(s)" pill — sits below the top nav whenever
 * the saved manifest diverges from current resources.
 *
 * Reads from manifest.diff (the same diff the CLI `status` command
 * uses), so the UI and CLI agree on what "pending" means:
 *   - someone saved a manifest via CLI `sync --preview` but didn't apply
 *   - a wizard create staged (no apply)
 *   - a postgres delete staged (no apply)
 *   - resources drifted out-of-band
 *
 * Hidden when there are no meaningful changes (`no-op` rows excluded).
 *   - Click the count → expands the change list inline
 *   - Discard → reverts the saved manifest to the last applied snapshot
 *   - Deploy → manifest.apply (no second code path)
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import type { Id, ID_PREFIX } from "@otterstack/shared/id";

import { Button } from "@/shared/components/ui/button";
import { orpc, queryClient } from "@/shared/server/orpc";

interface PendingChangesBarProps {
  projectId: Id<typeof ID_PREFIX.project>;
  environment?: string;
}

export function PendingChangesBar({ projectId, environment }: PendingChangesBarProps) {
  const [expanded, setExpanded] = useState(false);

  const diff = useQuery(
    orpc.project.manifest.diff.queryOptions({
      input: { projectId, environment },
      // Periodic refetch — picks up out-of-band changes (CLI sync from
      // another shell, etc.) without needing a project-wide event push.
      refetchInterval: 5_000,
    }),
  );

  const refreshAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.project.manifest.diff.queryKey({
          input: { projectId, environment },
        }),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.project.manifest.get.queryKey({ input: { id: projectId } }),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.project.resource.list.queryKey({ input: { projectId } }),
      }),
    ]);
  };

  const apply = async () => {
    try {
      const result = await orpc.project.manifest.apply.call({ projectId, environment });
      toast.success(`Applied ${result.appliedCount} change(s)`);
      await refreshAll();
      setExpanded(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(message || "Apply failed");
    }
  };

  const discard = async () => {
    try {
      await orpc.project.manifest.discard.call({ projectId });
      toast.success("Pending changes discarded");
      await refreshAll();
      setExpanded(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(message || "Discard failed");
    }
  };

  const meaningful = (diff.data?.changes ?? []).filter((c) => c.kind !== "no-op");
  if (meaningful.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-40 flex justify-center">
      <div className="pointer-events-auto flex flex-col items-stretch gap-0 overflow-hidden rounded-2xl border bg-card/95 shadow-lg backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1.5 text-sm font-medium text-foreground hover:opacity-80"
            aria-expanded={expanded}
          >
            <span
              className={`inline-block transition-transform ${expanded ? "rotate-90" : ""}`}
              aria-hidden
            >
              ▸
            </span>
            Apply {meaningful.length} change{meaningful.length === 1 ? "" : "s"}
          </button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void discard()}
            disabled={diff.isFetching}
          >
            Discard
          </Button>
          <Button
            size="sm"
            variant="default"
            onClick={() => void apply()}
            disabled={diff.isFetching}
          >
            Deploy
          </Button>
        </div>
        {expanded && (
          <ul className="max-h-64 list-none overflow-auto border-t bg-muted/30 px-4 py-2 text-xs">
            {meaningful.map((c, i) => (
              <li
                key={`${c.kind}-${c.resource}-${c.name}-${i}`}
                className="flex items-center gap-2 py-0.5 font-mono"
              >
                <ChangeSymbol kind={c.kind} />
                <span className="text-muted-foreground">{c.resource}</span>
                <span className="text-foreground">{c.name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ChangeSymbol({ kind }: { kind: string }) {
  const { ch, cls } =
    kind === "create"
      ? { ch: "+", cls: "text-success" }
      : kind === "delete"
        ? { ch: "−", cls: "text-destructive" }
        : kind === "update"
          ? { ch: "~", cls: "text-warning" }
          : { ch: "·", cls: "text-muted-foreground" };
  return (
    <span className={`inline-block w-3 text-center font-semibold ${cls}`}>{ch}</span>
  );
}
