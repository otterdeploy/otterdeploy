/**
 * Volumes inventory table. Attached-to chips deep-link to the owning
 * resource's graph panel; orphans get a warning badge (icon + label, never
 * color alone). Sizes render "—" when the daemon didn't report usage.
 */
import { ID_PREFIX, zSlug } from "@otterdeploy/shared/id";
import {
  Alert02Icon,
  CubeIcon,
  DatabaseIcon,
  Delete02Icon,
  EyeIcon,
  Layers01Icon,
  MoreVerticalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { cn } from "@/shared/lib/utils";

import type { VolumeAttachment, VolumeRow } from "./shared";

import { fmtBytes, timeAgoSeconds } from "./shared";

const ATTACHMENT_ICON = {
  database: DatabaseIcon,
  service: CubeIcon,
  compose: Layers01Icon,
} as const;

function AttachmentChip({
  orgSlug,
  attachment,
}: {
  orgSlug: string;
  attachment: VolumeAttachment;
}) {
  return (
    <Link
      to="/$orgSlug/$projectSlug/graph/$resourceId"
      params={{
        orgSlug,
        // Route param is the branded Slug<"project">; the API returns the
        // plain string it was derived from (same cast idiom as the graph's
        // own deep links, e.g. history-row-menu).
        projectSlug: zSlug(ID_PREFIX.project).parse(attachment.projectSlug),
        resourceId: attachment.resourceId,
      }}
      className="inline-flex h-5 max-w-full items-center gap-1 rounded-4xl bg-secondary px-2 text-xs font-medium text-secondary-foreground transition-all hover:bg-muted"
      title={`${attachment.resourceType}${attachment.engine ? ` · ${attachment.engine}` : ""} in ${attachment.projectSlug}`}
    >
      <HugeiconsIcon
        icon={ATTACHMENT_ICON[attachment.resourceType]}
        strokeWidth={2}
        className="size-3 shrink-0 text-muted-foreground"
      />
      <span className="truncate font-mono">{attachment.resourceName}</span>
    </Link>
  );
}

function StatusBadge({ volume }: { volume: VolumeRow }) {
  if (volume.orphan) {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-amber-600/30 text-amber-600 dark:border-amber-500/30 dark:text-amber-500"
      >
        <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="size-3" />
        orphan
      </Badge>
    );
  }
  if (volume.refCount > 0) {
    return (
      <Badge variant="default">in use{volume.refCount > 1 ? ` ×${volume.refCount}` : ""}</Badge>
    );
  }
  // Claimed by a platform resource whose container is currently gone
  // (stopped database, torn-down preview) — not in use, but not an orphan.
  return <Badge variant="secondary">unused</Badge>;
}

function RowMenu({
  volume,
  onInspect,
  onRemove,
}: {
  volume: VolumeRow;
  onInspect: (volume: VolumeRow) => void;
  onRemove: (volume: VolumeRow) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${volume.name}`}
          />
        }
      >
        <HugeiconsIcon icon={MoreVerticalIcon} strokeWidth={2} className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onSelect={() => onInspect(volume)}>
          <HugeiconsIcon icon={EyeIcon} strokeWidth={2} className="size-3.5" />
          Inspect
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => onRemove(volume)}>
          <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-3.5" />
          Remove…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function VolumesTable({
  volumes,
  orgSlug,
  onInspect,
  onRemove,
}: {
  volumes: VolumeRow[];
  orgSlug: string;
  onInspect: (volume: VolumeRow) => void;
  onRemove: (volume: VolumeRow) => void;
}) {
  return (
    <Card className="gap-0 overflow-hidden rounded-md p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Name</TableHead>
            <TableHead>Driver</TableHead>
            <TableHead>Size</TableHead>
            <TableHead>Mountpoint</TableHead>
            <TableHead>Attached to</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="w-10 pr-4" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {volumes.map((v) => (
            <TableRow key={v.name}>
              <TableCell className="max-w-[260px] pl-4">
                <span className="block truncate font-mono text-xs font-medium" title={v.name}>
                  {v.name}
                </span>
              </TableCell>
              <TableCell>
                <Badge variant="secondary" className="font-mono text-[10px]">
                  {v.driver}
                </Badge>
              </TableCell>
              <TableCell
                className={cn("text-muted-foreground", v.sizeBytes >= 0 && "font-mono text-xs")}
              >
                {fmtBytes(v.sizeBytes)}
              </TableCell>
              <TableCell
                className="max-w-[240px] truncate font-mono text-xs text-muted-foreground"
                title={v.mountpoint}
              >
                {v.mountpoint}
              </TableCell>
              <TableCell className="max-w-[260px]">
                {v.attachedTo.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1">
                    {v.attachedTo.map((a) => (
                      <AttachmentChip key={a.resourceId} orgSlug={orgSlug} attachment={a} />
                    ))}
                  </div>
                ) : v.refCount > 0 ? (
                  <span
                    className="block truncate text-xs text-muted-foreground"
                    title={v.containerNames.join(", ")}
                  >
                    {v.containerNames.length === 1
                      ? v.containerNames[0]
                      : `${v.containerNames.length} containers`}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                <StatusBadge volume={v} />
              </TableCell>
              <TableCell className="text-muted-foreground">{timeAgoSeconds(v.createdAt)}</TableCell>
              <TableCell className="pr-4 text-right">
                <RowMenu volume={v} onInspect={onInspect} onRemove={onRemove} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
