import { useState } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  SelectAllHead,
  SelectionBar,
  SelectRowCell,
  useTableSelection,
} from "@/shared/components/table-selection";
import { Badge } from "@/shared/components/ui/badge";
import { TableCell, TableRow } from "@/shared/components/ui/table";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import { DockerBulkRemoveDialog } from "./docker-bulk-remove";
import { ConfirmRemoveDialog, InspectDialog } from "./docker-dialogs";
import { formatBytes, shortId, splitRef, timeAgoSeconds } from "./docker-format";
import { Panel, type QueryLike } from "./docker-panel";
import { RowActionButton } from "./docker-tables";

/** Local row type — mirrors the docker contract output shape. */
interface Image {
  id: string;
  repoTags: string[];
  size: number;
  createdAt: number;
  containers: number;
}

export function ImagesTable({ query }: { query: QueryLike<Image> }) {
  const [inspectFor, setInspectFor] = useState<Image | null>(null);
  const [removeFor, setRemoveFor] = useState<Image | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  // Selection spans the WHOLE list, not the current page — paging away from a
  // selection and back must not silently drop it.
  const selection = useTableSelection(query.data ?? [], (img) => img.id);

  const inspect = useQuery({
    ...orpc.docker.images.inspect.queryOptions({ input: { id: inspectFor?.id ?? "" } }),
    enabled: inspectFor !== null,
  });

  const remove = useMutation(
    orpc.docker.images.remove.mutationOptions({
      onSuccess: (res) => {
        toast.success(
          res.deleted > 0
            ? `Image removed (${res.deleted} layer${res.deleted === 1 ? "" : "s"} deleted)`
            : "Image untagged",
        );
        setRemoveFor(null);
        query.refetch();
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  const removeRef = removeFor ? (splitRef(removeFor.repoTags[0] ?? "").repo ?? "") : "";

  return (
    <>
      <Panel
        query={query}
        headers={["Repository", "Tag", "Image ID", "Size", "In use", "Created", ""]}
        leadingHead={<SelectAllHead selection={selection} />}
        emptyTitle="No images"
        emptyText="No images are cached on this daemon."
      >
        {(rows) =>
          rows.map((img) => {
            const { repo, tag } = splitRef(img.repoTags[0] ?? "<none>:<none>");
            const inUse = img.containers > 0;
            return (
              <TableRow key={img.id}>
                <SelectRowCell selection={selection} row={img} label={repo} />
                <TableCell
                  className={cn(
                    "max-w-[260px] truncate font-mono text-xs",
                    repo === "<none>" ? "text-muted-foreground" : "font-medium",
                  )}
                  title={repo}
                >
                  {repo}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {tag || "—"}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {shortId(img.id)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatBytes(img.size)}
                </TableCell>
                <TableCell>
                  {img.containers < 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : inUse ? (
                    <Badge variant="secondary" className="bg-success/10 text-success">
                      {img.containers}
                    </Badge>
                  ) : (
                    <Badge variant="secondary">unused</Badge>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {timeAgoSeconds(img.createdAt)}
                </TableCell>
                <TableCell className="pr-4">
                  <div className="flex items-center justify-end gap-0.5">
                    <RowActionButton label="Inspect" onClick={() => setInspectFor(img)} />
                    <RowActionButton
                      label="Remove"
                      destructive
                      disabled={inUse}
                      title={
                        inUse
                          ? `In use by ${img.containers} container${img.containers === 1 ? "" : "s"}`
                          : undefined
                      }
                      onClick={() => setRemoveFor(img)}
                    />
                  </div>
                </TableCell>
              </TableRow>
            );
          })
        }
      </Panel>

      <InspectDialog
        open={inspectFor !== null}
        onOpenChange={(v) => !v && setInspectFor(null)}
        title="Inspect image"
        subtitle={
          inspectFor
            ? `${splitRef(inspectFor.repoTags[0] ?? "<none>").repo} · ${shortId(inspectFor.id)}`
            : ""
        }
        query={inspect}
      />
      <ConfirmRemoveDialog
        open={removeFor !== null}
        onOpenChange={(v) => !v && setRemoveFor(null)}
        title="Remove this image?"
        description={
          <>
            <span className="font-mono">{removeRef || shortId(removeFor?.id ?? "")}</span> will be
            deleted from this daemon&apos;s cache
            {removeFor ? ` (${formatBytes(removeFor.size)} reclaimed)` : ""}. The next deploy that
            needs it will pull or rebuild it from scratch.
          </>
        }
        confirmLabel="Remove image"
        pending={remove.isPending}
        onConfirm={() => {
          if (removeFor) remove.mutate({ id: removeFor.id });
        }}
      />

      <SelectionBar
        selection={selection}
        nounKey="docker.noun.image"
        actionLabel="Remove"
        onAction={() => setBulkOpen(true)}
        pending={bulkOpen}
      />
      <DockerBulkRemoveDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        selection={selection}
        nounKey="docker.noun.image"
        labelOf={(img) => splitRef(img.repoTags[0] ?? "").repo || shortId(img.id)}
        removeOne={(img) => orpc.docker.images.remove.call({ id: img.id })}
        consequence="They'll be deleted from this daemon's cache. The next deploy that needs one will pull or rebuild it from scratch. Images still backing a container will be skipped."
        onDone={() => query.refetch()}
      />
    </>
  );
}
