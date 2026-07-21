/**
 * Shared dialogs for the Docker raw page's row actions: raw-JSON inspect,
 * a bounded container-log tail, and a styled destructive confirm (never
 * window.confirm — the consequence copy is the point).
 */
import { Copy01Icon, RefreshIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
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
} from "@/shared/components/ui/alert-dialog";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { ErrorState } from "@/shared/components/ui/error-state";
import { JsonView } from "@/shared/components/ui/json-view";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied to clipboard`);
  } catch {
    toast.error("Couldn't access the clipboard");
  }
}

// ─── Inspect (raw JSON) ──────────────────────────────────────────────────────

export interface InspectQueryLike {
  data?: unknown;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
}

export function InspectDialog({
  open,
  onOpenChange,
  title,
  subtitle,
  query,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** e.g. "Inspect container" */
  title: string;
  /** Mono identifier under the title (name or 12-hex id). */
  subtitle: string;
  query: InspectQueryLike;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="flex-row items-center justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0">
            <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
            <DialogDescription className="mt-0.5 truncate font-mono text-xs">
              {subtitle}
            </DialogDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mr-6 h-7 shrink-0 gap-1.5 text-xs"
            disabled={query.data === undefined}
            onClick={() => copyText(JSON.stringify(query.data, null, 2), "JSON")}
          >
            <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} className="size-3.5" />
            Copy JSON
          </Button>
        </DialogHeader>
        <div className="max-h-[65vh] overflow-auto p-5">
          {query.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-3.5" style={{ width: `${90 - (i % 4) * 15}%` }} />
              ))}
            </div>
          ) : query.isError ? (
            <ErrorState
              title="Inspect failed"
              message={(query.error as Error | null)?.message}
              onRetry={() => query.refetch()}
            />
          ) : (
            <JsonView data={query.data} className="text-xs" />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Container logs (bounded tail) ───────────────────────────────────────────

const LOG_TAIL = 200;

export function ContainerLogsDialog({
  open,
  onOpenChange,
  container,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  container: { id: string; name: string } | null;
}) {
  const logs = useQuery({
    ...orpc.docker.containers.logs.queryOptions({
      input: { id: container?.id ?? "", tail: LOG_TAIL },
    }),
    enabled: open && container !== null,
    staleTime: 0,
  });

  const lines = logs.data?.lines ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="flex-row items-center justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0">
            <DialogTitle className="text-base font-semibold">Container logs</DialogTitle>
            <DialogDescription className="mt-0.5 truncate font-mono text-xs">
              {container?.name} · last {LOG_TAIL} lines
            </DialogDescription>
          </div>
          <div className="mr-6 flex shrink-0 items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              disabled={logs.isFetching}
              onClick={() => logs.refetch()}
            >
              <HugeiconsIcon
                icon={RefreshIcon}
                strokeWidth={2}
                className={cn("size-3.5", logs.isFetching && "animate-spin")}
              />
              Refresh
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              disabled={lines.length === 0}
              onClick={() => copyText(lines.map((l) => l.line).join("\n"), "Log tail")}
            >
              <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} className="size-3.5" />
              Copy
            </Button>
          </div>
        </DialogHeader>
        <div className="max-h-[65vh] overflow-auto bg-terminal text-terminal-foreground p-4">
          {logs.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton
                  key={i}
                  className="h-3 bg-white/10"
                  style={{ width: `${95 - (i % 3) * 20}%` }}
                />
              ))}
            </div>
          ) : logs.isError ? (
            <p className="font-mono text-xs text-red-300/90">
              {(logs.error as Error | null)?.message ?? "Couldn't fetch logs."}
            </p>
          ) : lines.length === 0 ? (
            <p className="font-mono text-xs text-terminal-foreground/40">No log output.</p>
          ) : (
            <pre className="font-mono text-[11px] leading-relaxed">
              {lines.map((l, i) => (
                <div
                  key={i}
                  className={cn(
                    "whitespace-pre-wrap break-all",
                    l.stream === "stderr" ? "text-destructive" : "text-terminal-foreground/80",
                  )}
                >
                  {l.line}
                </div>
              ))}
            </pre>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Destructive confirm ─────────────────────────────────────────────────────

export function ConfirmRemoveDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  /** Consequence copy — say what breaks, not just "are you sure". */
  description: React.ReactNode;
  confirmLabel: string;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive/10 text-destructive hover:bg-destructive/20"
            disabled={pending}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
          >
            {pending ? "Removing…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
