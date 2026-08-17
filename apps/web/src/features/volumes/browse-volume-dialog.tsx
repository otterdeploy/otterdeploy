/**
 * Read-only file explorer for one volume, backed by volumes.explore.* (a
 * disposable helper container mounts the volume read-only server-side).
 * Breadcrumb navigation, dirs-first listing, and an inline view of small
 * text files — binary and >256 KB files are named as not (fully) viewable
 * rather than silently mangled.
 */
import { useState } from "react";

import { File01Icon, Folder01Icon, Link01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { ErrorState } from "@/shared/components/ui/error-state";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import { fmtBytes, timeAgoSeconds } from "./shared";

export function BrowseVolumeDialog({
  name,
  onOpenChange,
}: {
  /** Volume to browse; null keeps the dialog closed. */
  name: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={name !== null} onOpenChange={onOpenChange}>
      {/* Keyed so switching volumes never carries the previous path along. */}
      {name !== null ? <BrowseBody key={name} name={name} /> : null}
    </Dialog>
  );
}

function BrowseBody({ name }: { name: string }) {
  // `path` is the directory being listed; `file` (when set) is the relative
  // path of the file being viewed — the listing stays cached underneath.
  const [path, setPath] = useState("");
  const [file, setFile] = useState<string | null>(null);

  const list = useQuery(orpc.volumes.explore.list.queryOptions({ input: { name, path } }));

  const crumbs = (file ?? path).split("/").filter(Boolean);

  const goTo = (dirPath: string) => {
    setFile(null);
    setPath(dirPath);
  };

  return (
    <DialogContent className="gap-0 p-0 sm:max-w-3xl">
      <DialogHeader className="border-b px-5 py-4">
        <DialogTitle className="text-base font-semibold">Browse files</DialogTitle>
        <DialogDescription className="mt-0.5 truncate font-mono text-xs">{name}</DialogDescription>
      </DialogHeader>

      {/* Breadcrumb — the last crumb is the current location, not a link. */}
      <nav
        aria-label="Volume path"
        className="flex flex-wrap items-center gap-0.5 border-b bg-muted/30 px-5 py-2 font-mono text-xs"
      >
        <BreadcrumbButton current={crumbs.length === 0} onClick={() => goTo("")}>
          /
        </BreadcrumbButton>
        {crumbs.map((segment, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <span key={`${i}-${segment}`} className="flex min-w-0 items-center gap-0.5">
              {i > 0 ? <span className="text-muted-foreground/50">/</span> : null}
              <BreadcrumbButton
                current={isLast}
                onClick={() => goTo(crumbs.slice(0, i + 1).join("/"))}
              >
                {segment}
              </BreadcrumbButton>
            </span>
          );
        })}
      </nav>

      <div className="max-h-[60vh] min-h-40 overflow-auto">
        {file !== null ? (
          <FileView name={name} path={file} />
        ) : list.isLoading ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-6" style={{ width: `${95 - (i % 3) * 12}%` }} />
            ))}
          </div>
        ) : list.isError ? (
          <div className="p-5">
            <ErrorState
              title="Couldn't list the directory"
              message={list.error instanceof Error ? list.error.message : undefined}
              onRetry={() => void list.refetch()}
            />
          </div>
        ) : (list.data?.entries.length ?? 0) === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">Empty directory</p>
        ) : (
          <ul className="py-1">
            {list.data?.entries.map((entry) => (
              <EntryRow
                key={entry.name}
                entry={entry}
                onOpen={() => {
                  const next = path === "" ? entry.name : `${path}/${entry.name}`;
                  if (entry.kind === "dir") setPath(next);
                  else if (entry.kind === "file") setFile(next);
                }}
              />
            ))}
          </ul>
        )}
      </div>

      <p className="border-t px-5 py-2 text-[11px] text-muted-foreground">
        Read-only view — files over 256 KB are shown truncated; binary files aren't rendered.
      </p>
    </DialogContent>
  );
}

function BreadcrumbButton({
  current,
  onClick,
  children,
}: {
  current: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  if (current) {
    return (
      <span aria-current="location" className="max-w-48 truncate px-1 py-0.5 font-medium">
        {children}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="max-w-48 truncate rounded-sm px-1 py-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}

const ENTRY_ICON = {
  dir: Folder01Icon,
  file: File01Icon,
  symlink: Link01Icon,
  other: File01Icon,
} as const;

interface DirEntry {
  name: string;
  kind: "file" | "dir" | "symlink" | "other";
  size: number;
  mtime: number;
  mode: string;
}

function EntryRow({ entry, onOpen }: { entry: DirEntry; onOpen: () => void }) {
  // Symlinks and special files are listed honestly but not openable — the
  // server refuses to dereference them anyway.
  const openable = entry.kind === "dir" || entry.kind === "file";
  return (
    <li>
      <button
        type="button"
        disabled={!openable}
        onClick={onOpen}
        title={`mode ${entry.mode}`}
        className={cn(
          "flex w-full items-center gap-2.5 px-5 py-1.5 text-left transition-colors",
          openable ? "hover:bg-muted/50" : "cursor-default opacity-60",
        )}
      >
        <HugeiconsIcon
          icon={ENTRY_ICON[entry.kind]}
          strokeWidth={2}
          className={cn(
            "size-3.5 shrink-0",
            entry.kind === "dir" ? "text-foreground/70" : "text-muted-foreground",
          )}
        />
        <span className="min-w-0 flex-1 truncate font-mono text-xs">
          {entry.name}
          {entry.kind === "dir" ? <span className="text-muted-foreground">/</span> : null}
        </span>
        {entry.kind === "symlink" || entry.kind === "other" ? (
          <span className="shrink-0 text-[11px] text-muted-foreground">{entry.kind}</span>
        ) : null}
        <span className="w-16 shrink-0 text-right font-mono text-[11px] text-muted-foreground">
          {entry.kind === "file" ? fmtBytes(entry.size) : ""}
        </span>
        <span className="w-24 shrink-0 text-right text-[11px] text-muted-foreground">
          {timeAgoSeconds(entry.mtime)}
        </span>
      </button>
    </li>
  );
}

function FileView({ name, path }: { name: string; path: string }) {
  const read = useQuery(orpc.volumes.explore.read.queryOptions({ input: { name, path } }));

  if (read.isLoading) {
    return (
      <div className="space-y-2 p-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-3.5" style={{ width: `${92 - (i % 5) * 14}%` }} />
        ))}
      </div>
    );
  }
  if (read.isError) {
    return (
      <div className="p-5">
        <ErrorState
          title="Couldn't read the file"
          message={read.error instanceof Error ? read.error.message : undefined}
          onRetry={() => void read.refetch()}
        />
      </div>
    );
  }
  const data = read.data;
  if (!data) return null;

  if (data.binary) {
    return (
      <p className="px-5 py-8 text-center text-sm text-muted-foreground">
        Binary file · {fmtBytes(data.size)} — not viewable here.
      </p>
    );
  }
  return (
    <div>
      {data.truncated ? (
        <p className="border-b border-amber-600/20 bg-amber-500/5 px-5 py-2 text-[11px] text-amber-600 dark:text-amber-500">
          Showing the first 256 KB of {fmtBytes(data.size)}.
        </p>
      ) : null}
      <pre className="overflow-x-auto p-5 font-mono text-xs leading-relaxed whitespace-pre">
        {data.content}
      </pre>
    </div>
  );
}
