/**
 * Presentational rows + panes for the Root Directory picker. Split out of
 * root-directory-picker.tsx to keep that file under the max-lines cap.
 * `RootDirectoryPicker` and `BrowsePane` (the orchestrators) live there and
 * compose these leaves.
 */

import { GithubIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Spinner } from "@/shared/components/ui/spinner";

import {
  FRAMEWORK_LABEL,
  humanizeUpstreamMessage,
  type InspectResult,
  isHiddenDir,
  MONOREPO_LABEL,
} from "./root-directory-picker-data";
import { Breadcrumbs, FolderList } from "./root-directory-picker-folder-list";

export function RepoHeader({ fullName }: { fullName: string | null }) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2">
      <HugeiconsIcon icon={GithubIcon} strokeWidth={2} className="size-4" />
      <span className="font-mono text-[12.5px]">{fullName ?? "linked repository"}</span>
    </div>
  );
}

export function BrowsePaneHeader({
  path,
  onNavigate,
  inspect,
  showHidden,
  onToggleHidden,
}: {
  path: string;
  onNavigate: (next: string) => void;
  inspect: InspectResult | undefined;
  showHidden: boolean;
  onToggleHidden: () => void;
}) {
  const hiddenCount = (inspect?.entries ?? []).filter(
    (e) => e.type === "dir" && isHiddenDir(e.name),
  ).length;

  return (
    <div className="flex items-center justify-between gap-2">
      <Breadcrumbs path={path} onNavigate={onNavigate} />
      <div className="flex items-center gap-2">
        {inspect?.monorepo && (
          <Badge variant="outline" className="font-normal">
            {MONOREPO_LABEL[inspect.monorepo]}
          </Badge>
        )}
        {hiddenCount > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px] text-muted-foreground"
            onClick={onToggleHidden}
          >
            {showHidden ? "Hide" : "Show"} hidden ({hiddenCount})
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Renders one of four states: loading spinner, rate-limit warning,
 * generic upstream error, or the actual folder list. Splitting this out
 * keeps `BrowsePane`'s cyclomatic complexity inside the linter's cap.
 */
export function BrowsePaneBody({
  path,
  selected,
  onNavigate,
  onSelect,
  inspect,
  showHidden,
  isLoading,
  rateLimited,
  errorMessage,
}: {
  path: string;
  selected: string;
  onNavigate: (next: string) => void;
  onSelect: (next: string) => void;
  inspect: InspectResult | undefined;
  showHidden: boolean;
  isLoading: boolean;
  rateLimited: boolean;
  errorMessage: string | null | undefined;
}) {
  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (rateLimited) return <RateLimitedNotice />;
  if (errorMessage != null) {
    return <UpstreamErrorNotice path={path} rawMessage={errorMessage} />;
  }
  return (
    <FolderList
      path={path}
      selected={selected}
      onNavigate={onNavigate}
      onSelect={onSelect}
      inspect={inspect}
      showHidden={showHidden}
    />
  );
}

function RateLimitedNotice() {
  return (
    <div className="rounded-md border border-warning/40 bg-warning/5 px-3 py-3 text-[12.5px] text-warning">
      <div className="font-semibold">Rate-limited by GitHub</div>
      <p className="mt-1 text-warning/80">
        Anonymous reads are capped at 60/hour per IP. Connect the GitHub App from the Source card
        above for a 5000/hour limit, or wait a few minutes and retry.
      </p>
    </div>
  );
}

function UpstreamErrorNotice({ path, rawMessage }: { path: string; rawMessage: string }) {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-[12.5px] text-destructive">
      Couldn't read repo at <span className="font-mono">/{path}</span> —{" "}
      {humanizeUpstreamMessage(rawMessage)}
    </div>
  );
}

export function DetectedStack({
  framework,
}: {
  framework: NonNullable<InspectResult["framework"]>;
}) {
  return (
    <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
      <span>Detected stack:</span>
      <Badge variant="outline" className="font-normal">
        {FRAMEWORK_LABEL[framework]}
      </Badge>
    </div>
  );
}
