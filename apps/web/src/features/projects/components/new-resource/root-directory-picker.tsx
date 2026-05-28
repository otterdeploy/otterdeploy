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
 */

import { useState } from "react";
import { usePrefetchQuery, useQuery } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  FolderIcon,
  Folder01Icon,
  GithubIcon,
} from "@hugeicons/core-free-icons";

import { Badge } from "@/shared/components/ui/badge";
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
import { RadioGroup, RadioGroupItem } from "@/shared/components/ui/radio-group";
import { Spinner } from "@/shared/components/ui/spinner";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

type FrameworkKind =
  | "next"
  | "nuxt"
  | "vite"
  | "remix"
  | "astro"
  | "sveltekit"
  | "react"
  | "vue"
  | "express"
  | "fastify"
  | "hono"
  | "nest"
  | "node"
  | "bun"
  | "go"
  | "python"
  | "rust"
  | "ruby"
  | "static"
  | null;

type MonorepoKind =
  | "turbo"
  | "nx"
  | "pnpm-workspace"
  | "yarn-workspace"
  | "npm-workspace"
  | "lerna"
  | null;

// Shape of `git.inspectRepo` output. Mirrored locally so the sub-
// components below can pass it around without dragging the orpc client
// types through every prop signature.
type InspectResult = {
  path: string;
  entries: Array<{ name: string; type: "dir" | "file" }>;
  framework: FrameworkKind;
  monorepo: MonorepoKind;
  monorepoPackages: string[];
};

const FRAMEWORK_LABEL: Record<NonNullable<FrameworkKind>, string> = {
  next: "Next.js",
  nuxt: "Nuxt",
  vite: "Vite",
  remix: "Remix",
  astro: "Astro",
  sveltekit: "SvelteKit",
  react: "React",
  vue: "Vue",
  express: "Express",
  fastify: "Fastify",
  hono: "Hono",
  nest: "NestJS",
  node: "Node",
  bun: "Bun",
  go: "Go",
  python: "Python",
  rust: "Rust",
  ruby: "Ruby",
  static: "Static",
};

const MONOREPO_LABEL: Record<NonNullable<MonorepoKind>, string> = {
  turbo: "Turborepo",
  nx: "Nx",
  "pnpm-workspace": "pnpm workspaces",
  "yarn-workspace": "yarn workspaces",
  "npm-workspace": "npm workspaces",
  lerna: "Lerna",
};

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

  usePrefetchQuery({
    ...orpc.git.inspectRepo.queryOptions({
      input: { gitRepoId: gitRepoId, path },
    }),
  });

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
        <span className="font-mono text-[12.5px] text-muted-foreground">
          (no repo bound)
        </span>
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
          <span className="truncate font-mono text-[12.5px]">
            {value || "(root)"}
          </span>
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
            Select the directory inside the repo that contains this service's
            source code. For monorepos, deploy one service per app folder.
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen(false)}
          >
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

function RepoHeader({ fullName }: { fullName: string | null }) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2">
      <HugeiconsIcon icon={GithubIcon} strokeWidth={2} className="size-4" />
      <span className="font-mono text-[12.5px]">
        {fullName ?? "linked repository"}
      </span>
    </div>
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
      input: { gitRepoId: gitRepoId, path },
    }),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const inspect = inspectQuery.data;

  return (
    <div className="flex flex-col gap-2">
      <BrowsePaneHeader path={path} onNavigate={onNavigate} inspect={inspect} />
      <BrowsePaneBody
        path={path}
        selected={selected}
        onNavigate={onNavigate}
        onSelect={onSelect}
        inspect={inspect}
        isLoading={inspectQuery.isLoading}
        rateLimited={isRateLimitedError(inspectQuery.error)}
        errorMessage={inspectQuery.isError ? inspectQuery.error?.message : null}
      />
      {inspect?.framework && <DetectedStack framework={inspect.framework} />}
    </div>
  );
}

function BrowsePaneHeader({
  path,
  onNavigate,
  inspect,
}: {
  path: string;
  onNavigate: (next: string) => void;
  inspect: InspectResult | undefined;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Breadcrumbs path={path} onNavigate={onNavigate} />
      {inspect?.monorepo && (
        <Badge variant="outline" className="font-normal">
          {MONOREPO_LABEL[inspect.monorepo]}
        </Badge>
      )}
    </div>
  );
}

/**
 * Renders one of four states: loading spinner, rate-limit warning,
 * generic upstream error, or the actual folder list. Splitting this out
 * keeps `BrowsePane`'s cyclomatic complexity inside the linter's cap.
 */
function BrowsePaneBody({
  path,
  selected,
  onNavigate,
  onSelect,
  inspect,
  isLoading,
  rateLimited,
  errorMessage,
}: {
  path: string;
  selected: string;
  onNavigate: (next: string) => void;
  onSelect: (next: string) => void;
  inspect: InspectResult | undefined;
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
    />
  );
}

function FolderList({
  path,
  selected,
  onNavigate,
  onSelect,
  inspect,
}: {
  path: string;
  selected: string;
  onNavigate: (next: string) => void;
  onSelect: (next: string) => void;
  inspect: InspectResult | undefined;
}) {
  const isRoot = path === "";
  const parent = isRoot ? null : path.split("/").slice(0, -1).join("/");
  const dirs = (inspect?.entries ?? []).filter((e) => e.type === "dir");
  const monorepoPackages = new Set(inspect?.monorepoPackages ?? []);

  return (
    // The radio group's `value` is the committed selection. Each row's
    // RadioGroupItem carries the folder path as its value; RadioGroup's
    // `onValueChange` lifts the pick.
    <RadioGroup
      value={selected}
      onValueChange={(next) => {
        if (typeof next === "string") onSelect(next);
      }}
      className="max-h-72 gap-0 overflow-y-auto rounded-md border bg-card"
    >
      {parent !== null && <ParentRow onClick={() => onNavigate(parent)} />}

      {/* (root) pseudo-row, only at the repo root — gives the operator
          an explicit way to commit "deploy from repo root" without
          picking a subfolder. */}
      {isRoot && (
        <FolderRow
          label="(root)"
          fullPath=""
          isPackage={false}
          isSelected={selected === ""}
          canNavigateIn={false}
          onNavigateIn={() => undefined}
        />
      )}

      {dirs.map((entry) => {
        const fullPath = path ? `${path}/${entry.name}` : entry.name;
        return (
          <FolderRow
            key={fullPath}
            label={entry.name}
            fullPath={fullPath}
            isPackage={monorepoPackages.has(fullPath)}
            isSelected={selected === fullPath}
            canNavigateIn
            onNavigateIn={() => onNavigate(fullPath)}
          />
        );
      })}

      {dirs.length === 0 && !isRoot && (
        <div className="px-3 py-4 text-center text-[12px] text-muted-foreground">
          No subfolders here
        </div>
      )}
    </RadioGroup>
  );
}

function ParentRow({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 border-b border-border/40 px-3 py-2 text-left hover:bg-muted/40"
    >
      <HugeiconsIcon
        icon={ArrowLeft01Icon}
        strokeWidth={2}
        className="size-3.5 text-muted-foreground"
      />
      <span className="font-mono text-[12.5px] text-muted-foreground">..</span>
    </button>
  );
}

function RateLimitedNotice() {
  return (
    <div className="rounded-md border border-warning/40 bg-warning/5 px-3 py-3 text-[12.5px] text-warning">
      <div className="font-semibold">Rate-limited by GitHub</div>
      <p className="mt-1 text-warning/80">
        Anonymous reads are capped at 60/hour per IP. Connect the GitHub App
        from the Source card above for a 5000/hour limit, or wait a few minutes
        and retry.
      </p>
    </div>
  );
}

function UpstreamErrorNotice({
  path,
  rawMessage,
}: {
  path: string;
  rawMessage: string;
}) {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-[12.5px] text-destructive">
      Couldn't read repo at <span className="font-mono">/{path}</span> —{" "}
      {humanizeUpstreamMessage(rawMessage)}
    </div>
  );
}

function DetectedStack({
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

/**
 * One row in the BrowsePane. Radio on the left (selects), folder name
 * in the middle (clicking the label also selects via the surrounding
 * `<label>`), chevron on the right (navigates IN — the only escape
 * hatch to drill deeper).
 */
function FolderRow({
  label,
  fullPath,
  isPackage,
  isSelected,
  canNavigateIn,
  onNavigateIn,
}: {
  label: string;
  fullPath: string;
  isPackage: boolean;
  isSelected: boolean;
  canNavigateIn: boolean;
  onNavigateIn: () => void;
}) {
  return (
    <label
      className={cn(
        "flex w-full items-center gap-3 border-b border-border/40 px-3 py-2 last:border-b-0 cursor-pointer",
        isSelected ? "bg-muted/50" : "hover:bg-muted/30",
      )}
    >
      <RadioGroupItem value={fullPath} />
      <HugeiconsIcon
        icon={FolderIcon}
        strokeWidth={2}
        className="size-3.5 shrink-0 text-foreground/70"
      />
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate font-mono text-[12.5px]">{label}</span>
        {isPackage && (
          <Badge variant="secondary" className="font-normal">
            package
          </Badge>
        )}
      </span>
      {canNavigateIn ? (
        <button
          type="button"
          onClick={(e) => {
            // Prevent the surrounding <label> from toggling the radio
            // when the operator just wants to drill deeper.
            e.preventDefault();
            e.stopPropagation();
            onNavigateIn();
          }}
          aria-label={`Browse into ${label}`}
          className="grid size-7 place-items-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground"
        >
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            strokeWidth={2}
            className="size-3.5"
          />
        </button>
      ) : (
        <span className="size-7" />
      )}
    </label>
  );
}

/**
 * The contract surfaces RATE_LIMITED as a typed oRPC error. orpc client
 * spreads the error code into the thrown error, so we key off that.
 * Fall back to a body-substring check in case the typed envelope was
 * lost in transit (older client, proxy strip, etc.).
 */
function isRateLimitedError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  if (code === "RATE_LIMITED") return true;
  const msg = (err as { message?: unknown }).message;
  if (typeof msg !== "string") return false;
  return /api rate limit exceeded/i.test(msg);
}

/**
 * Strip GitHub's `{"message":"…","documentation_url":"…"}` wrapper when
 * the server forwards an upstream body as-is. Keeps the picker copy
 * legible instead of dumping JSON in front of the operator.
 */
function humanizeUpstreamMessage(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "upstream error";
  try {
    const parsed = JSON.parse(trimmed) as { message?: string };
    if (typeof parsed.message === "string" && parsed.message.length > 0) {
      return parsed.message;
    }
  } catch {
    /* not json */
  }
  return trimmed;
}

function Breadcrumbs({
  path,
  onNavigate,
}: {
  path: string;
  onNavigate: (next: string) => void;
}) {
  const segments = path ? path.split("/") : [];
  return (
    <div className="flex flex-wrap items-center gap-1 font-mono text-[12px]">
      <button
        type="button"
        onClick={() => onNavigate("")}
        className={cn(
          "rounded px-1.5 py-0.5 hover:bg-muted/40",
          segments.length === 0 && "text-foreground",
        )}
      >
        /
      </button>
      {segments.map((seg, i) => {
        const upto = segments.slice(0, i + 1).join("/");
        const isLast = i === segments.length - 1;
        return (
          <span key={upto} className="flex items-center gap-1">
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              strokeWidth={2}
              className="size-3 text-muted-foreground/50"
            />
            <button
              type="button"
              onClick={() => onNavigate(upto)}
              className={cn(
                "rounded px-1.5 py-0.5 hover:bg-muted/40",
                isLast && "text-foreground",
              )}
            >
              {seg}
            </button>
          </span>
        );
      })}
    </div>
  );
}
