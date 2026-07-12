/**
 * Raw `docker volume inspect` JSON for one volume — the honest, unabridged
 * daemon view, fetched on open. Mirrors the Docker page's InspectDialog
 * composition (title + mono subtitle + Copy JSON) so the two read as one
 * vocabulary.
 */
import { Copy01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

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
import { orpc } from "@/shared/server/orpc";

export function InspectVolumeDialog({
  name,
  onOpenChange,
}: {
  /** Volume to inspect; null keeps the dialog closed. */
  name: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={name !== null} onOpenChange={onOpenChange}>
      {name !== null ? <InspectBody name={name} /> : null}
    </Dialog>
  );
}

function InspectBody({ name }: { name: string }) {
  const inspect = useQuery(orpc.volumes.inspect.queryOptions({ input: { name } }));

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(inspect.data?.raw, null, 2));
      toast.success("JSON copied to clipboard");
    } catch {
      toast.error("Couldn't access the clipboard");
    }
  };

  return (
    <DialogContent className="gap-0 p-0 sm:max-w-3xl">
      <DialogHeader className="flex-row items-center justify-between gap-3 border-b px-5 py-4">
        <div className="min-w-0">
          <DialogTitle className="text-base font-semibold">Inspect volume</DialogTitle>
          <DialogDescription className="mt-0.5 truncate font-mono text-xs">
            {name}
          </DialogDescription>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mr-6 h-7 shrink-0 gap-1.5 text-xs"
          disabled={inspect.data === undefined}
          onClick={() => void copyJson()}
        >
          <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} className="size-3.5" />
          Copy JSON
        </Button>
      </DialogHeader>
      <div className="max-h-[65vh] overflow-auto p-5">
        {inspect.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-3.5" style={{ width: `${90 - (i % 4) * 15}%` }} />
            ))}
          </div>
        ) : inspect.isError ? (
          <ErrorState
            title="Couldn't inspect the volume"
            message={inspect.error instanceof Error ? inspect.error.message : undefined}
            onRetry={() => void inspect.refetch()}
          />
        ) : (
          <JsonView data={inspect.data?.raw} className="text-xs" />
        )}
      </div>
    </DialogContent>
  );
}
