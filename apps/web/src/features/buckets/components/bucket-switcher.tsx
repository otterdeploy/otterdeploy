/**
 * The bucket switcher: which keyspace the workbench is pointed at.
 *
 * Lives in the header's crumb trail — `acme / acme-uploads` — because which
 * bucket you are in is the same species of fact as which org, and it belongs
 * in the same row. Moving it out of the rail gives the rail entirely to the
 * prefix tree.
 *
 * Connecting a bucket is offered here too: it is the same act as adding an
 * S3 backup destination, one credential stored once.
 */
import { ArrowDown01Icon, FolderLibraryIcon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { cn } from "@/shared/lib/utils";

import type { BucketRow } from "../data/buckets-data";

import { providerLabel } from "../state";

export function BucketSwitcher({
  buckets,
  active,
  isLoading,
  onPick,
  onConnect,
}: {
  buckets: readonly BucketRow[];
  active: BucketRow | undefined;
  isLoading: boolean;
  onPick: (id: string) => void;
  onConnect: () => void;
}) {
  return (
    <DropdownMenu>
      {/* Styled as a crumb, not a form control: it has to read as the same
          species as the org switcher beside it. */}
      <DropdownMenuTrigger className="inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none data-popup-open:bg-accent">
        <StatusDot status={active?.status} />
        <span className="max-w-[18ch] truncate">
          {isLoading ? "Loading…" : (active?.name ?? "No bucket")}
        </span>
        {active !== undefined ? (
          <span className="shrink-0 rounded bg-muted px-1 py-0.5 font-mono text-[9.5px] tracking-wide text-muted-foreground">
            {providerLabel(active)}
          </span>
        ) : null}
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          strokeWidth={2}
          className="size-3.5 shrink-0 text-muted-foreground"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80">
        {buckets.map((b) => (
          <DropdownMenuItem
            key={b.id}
            onClick={() => onPick(b.id)}
            className={cn("gap-2", b.id === active?.id && "bg-accent")}
          >
            <HugeiconsIcon
              icon={FolderLibraryIcon}
              strokeWidth={2}
              className="size-3.5 shrink-0 text-muted-foreground"
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[13px] font-medium">{b.name}</span>
              <span className="truncate font-mono text-[10.5px] text-muted-foreground">
                {b.bucket}
                {b.root === "" ? "" : `/${b.root}`} · {providerLabel(b)}
              </span>
            </span>
            {b.status !== "active" ? (
              <span
                className={cn(
                  "shrink-0 font-mono text-[9.5px] tracking-wide uppercase",
                  b.status === "degraded" ? "text-warning" : "text-muted-foreground",
                )}
              >
                {b.status}
              </span>
            ) : null}
          </DropdownMenuItem>
        ))}

        {buckets.length > 0 ? <DropdownMenuSeparator /> : null}

        <DropdownMenuItem onClick={onConnect} className="gap-2 text-primary">
          <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="size-3.5" />
          Connect a bucket…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StatusDot({ status }: { status: BucketRow["status"] | undefined }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        status === "active" && "bg-success",
        status === "degraded" && "bg-warning",
        (status === "disabled" || status === undefined) && "bg-muted-foreground/40",
      )}
    />
  );
}
