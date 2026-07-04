/**
 * Root Directory picker — Vercel-style "Import Git Repository" flow.
 *
 * Backed by orpc.git.inspectRepo, which walks the GitHub Contents API
 * for the bound gitRepoId. The trigger shows the current value; the
 * dialog lets the operator navigate folders, surfacing a detected
 * framework badge per row + a monorepo hint at the root.
 *
 * The picker doesn't write back through a query mutation — it owns a
 * local "currently browsing" path and only commits to the form via the
 * `onChange` callback when the operator clicks Select.
 *
 * Presentational rows + panes live in ./root-directory-picker-rows; shared
 * types + helpers in ./root-directory-picker-data.
 */

import { useState } from "react";

import { FolderIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { skipToken, useQuery } from "@tanstack/react-query";

import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog";
import { orpc } from "@/shared/server/orpc";

import { isRateLimitedError } from "./root-directory-picker-data";
import {
  BrowsePaneBody,
  BrowsePaneHeader,
  DetectedStack,
  RepoHeader,
} from "./root-directory-picker-rows";

interface RootDirectoryPickerProps {
  gitRepoId: string | null;
  /** Current form value — the path that was last committed. */
  value: string;
  /** Called when the operator picks a folder and clicks Select. */
  onChange: (path: string) => void;
  /** Optional display label for the repo (full_name). */
  repoFullName?: string | null;
}

export function RootDirectoryPicker({
  gitRepoId,
  value,
  onChange,
  repoFullName,
}: RootDirectoryPickerProps) {
  const [open, setOpen] = useState(false);
  // Two independent paths inside the dialog:
  //   browsePath  — which folder's contents are currently visible
  //   selected    — the radio-picked folder, what "Use this folder" commits
  // They diverge whenever the operator drills into a subfolder without
  // picking it (e.g. opens `apps/` to confirm `apps/web` is in there).
  const [browsePath, setBrowsePath] = useState<string>(value);
  const [selected, setSelected] = useState<string>(value);

  // Cache-warm the current folder before the dialog opens. Runs above the
  // `if (!gitRepoId) return` guard, so gate the request itself with skipToken:
  // no repo bound = disabled query = no call. `useQuery` (not usePrefetchQuery)
  // because prefetch ignores `enabled`/skipToken and throws "queryFn should not
  // be called with skipToken"; useQuery disables cleanly on skipToken instead.
  useQuery(
    orpc.git.inspectRepo.queryOptions({
      input: gitRepoId ? { gitRepoId, path: browsePath } : skipToken,
    }),
  );

  const onOpenChange = (next: boolean) => {
    if (next) {
      setBrowsePath(value);
      setSelected(value);
    }
    setOpen(next);
  };

  if (!gitRepoId) {
    return (
      <div className="flex items-center justify-between rounded-md border bg-muted/20 px-3 py-2">
        <span className="font-mono text-[12.5px] text-muted-foreground">(no repo bound)</span>
        <Button type="button" variant="outline" size="sm" disabled>
          Edit
        </Button>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <div className="flex items-center justify-between gap-2 rounded-md border bg-card px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <HugeiconsIcon
            icon={FolderIcon}
            strokeWidth={2}
            className="size-4 shrink-0 text-muted-foreground"
          />
          <span className="truncate font-mono text-[12.5px]">{value || "(root)"}</span>
        </div>
        <DialogTrigger
          render={
            <Button type="button" variant="outline" size="sm">
              Edit
            </Button>
          }
        />
      </div>

      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Root Directory</DialogTitle>
          <DialogDescription>
            Select the directory inside the repo that contains this service's source code. For
            monorepos, deploy one service per app folder.
          </DialogDescription>
        </DialogHeader>

        <RepoHeader fullName={repoFullName ?? null} />

        <BrowsePane
          gitRepoId={gitRepoId}
          path={browsePath}
          selected={selected}
          onNavigate={setBrowsePath}
          onSelect={setSelected}
        />

        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              onChange(selected);
              setOpen(false);
            }}
          >
            Use {selected ? `/${selected}` : "(root)"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One pane = one path's listing. Only directories render — files
 * aren't valid root choices, so they'd just be visual noise.
 *
 * Each row holds a radio (selects the folder) and a chevron button
 * (navigates INTO the folder). The two actions are decoupled so the
 * operator can drill deeper to verify a structure without losing their
 * radio pick, and select without leaving the current view.
 */
function BrowsePane({
  gitRepoId,
  path,
  selected,
  onNavigate,
  onSelect,
}: {
  gitRepoId: string;
  path: string;
  selected: string;
  onNavigate: (next: string) => void;
  onSelect: (next: string) => void;
}) {
  // Long staleTime + gcTime: the backend caches the whole tree on the
  // first call, so navigating within the dialog should be free locally.
  // 5min staleTime matches the server-side CACHE_TTL_MS.
  const inspectQuery = useQuery({
    ...orpc.git.inspectRepo.queryOptions({
      input: { gitRepoId, path },
    }),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const inspect = inspectQuery.data;
  // Dotfolders (.github, .changeset, …) are almost never a deploy root, so
  // they're hidden by default with an opt-in toggle.
  const [showHidden, setShowHidden] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <BrowsePaneHeader
        path={path}
        onNavigate={onNavigate}
        inspect={inspect}
        showHidden={showHidden}
        onToggleHidden={() => setShowHidden((v) => !v)}
      />
      <BrowsePaneBody
        path={path}
        selected={selected}
        onNavigate={onNavigate}
        onSelect={onSelect}
        inspect={inspect}
        showHidden={showHidden}
        isLoading={inspectQuery.isLoading}
        rateLimited={isRateLimitedError(inspectQuery.error)}
        errorMessage={inspectQuery.isError ? inspectQuery.error?.message : null}
      />
      {inspect?.framework && <DetectedStack framework={inspect.framework} />}
    </div>
  );
}
