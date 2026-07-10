import { useState } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "@/shared/components/ui/badge";
import { TableCell, TableRow } from "@/shared/components/ui/table";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

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
        emptyTitle="No images"
        emptyText="No images are cached on this daemon."
      >
        {(rows) =>
          rows.map((img) => {
            const { repo, tag } = splitRef(img.repoTags[0] ?? "<none>:<none>");
            const inUse = img.containers > 0;
            return (
              <TableRow key={img.id}>
                <TableCell
                  className={cn(
                    "max-w-[260px] truncate pl-4 font-mono text-xs",
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
    </>
  );
}
