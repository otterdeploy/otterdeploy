/**
 * Per-service pickers for the Source step: workload-type toggle, branch
 * selector, and the post-bind repo check. Split out of source.tsx to keep
 * that file under the max-lines cap.
 */

import { useEffect } from "react";

import { Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";

import { FrameworkLogo, type FrameworkKind } from "@/features/projects/components/framework-logo";
import { Badge } from "@/shared/components/ui/badge";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/shared/components/ui/combobox";
import { Input } from "@/shared/components/ui/input";
import { Spinner } from "@/shared/components/ui/spinner";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import { frameworkLabel, monorepoLabel } from "../frameworks";

/**
 * Workload-type picker for a git-sourced service. Source and role are
 * orthogonal — you can build a web app OR a static site from the same repo —
 * so the role lives here as a field rather than as a top-level launch card.
 * Drives `kindId` directly: "app" (dynamic) ↔ "static". `to-manifest` reads
 * the static kind to emit a Caddy static build; everything else is a normal
 * railpack app. Worker / cron / one-off jobs aren't distinctly wired yet.
 */
export function ServiceTypeSelector({
  kindId,
  onChange,
}: {
  kindId: string;
  onChange: (kindId: string) => void;
}) {
  const isStatic = kindId === "static";
  const options: Array<[string, string]> = [
    ["app", "Web app"],
    ["static", "Static site"],
  ];
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-medium">Service type</span>
      <div className="inline-flex w-fit rounded-md border p-0.5">
        {options.map(([id, label]) => {
          const active = id === "static" ? isStatic : !isStatic;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChange(id)}
              className={cn(
                "cursor-pointer rounded-[5px] px-3 py-1 text-[12px] transition-colors",
                active
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {isStatic
          ? "Pre-built HTML/CSS/JS served from the edge."
          : "HTTP service built from your repo. Worker, cron & one-off jobs — coming soon."}
      </p>
    </div>
  );
}

/** Repo full_name → a sane default service name (DNS-label-ish). */
export function deriveServiceName(fullName: string): string {
  const last = fullName.split("/").pop() ?? fullName;
  return last
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

/**
 * Branch selector backed by the real `git.listBranches`. Defaults the
 * selection to the repo's default branch. Falls back to a free-text input if
 * the listing fails (rate-limited / unreachable) so the operator can still
 * name a branch.
 */
export function BranchPicker({
  gitRepoId,
  value,
  onChange,
}: {
  gitRepoId: string;
  value: string;
  onChange: (branch: string) => void;
}) {
  const query = useQuery(orpc.git.listBranches.queryOptions({ input: { gitRepoId } }));

  const defaultBranch = query.data?.defaultBranch;
  // Seed the form's branch from the repo default once it loads, if unset.
  useEffect(() => {
    if (!value && defaultBranch) onChange(defaultBranch);
  }, [value, defaultBranch, onChange]);

  if (query.isLoading) {
    return (
      <div className="flex h-8 items-center gap-2 rounded-md border bg-muted/20 px-3 text-[12px] text-muted-foreground">
        <Spinner className="size-3.5" />
        Loading branches…
      </div>
    );
  }

  if (query.isError) {
    return (
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="main"
        className="h-8 font-mono text-[12.5px]"
      />
    );
  }

  const branches = query.data?.branches ?? [];
  const selected = value || defaultBranch || "";

  // Searchable — repos like cal.com have hundreds of branches, so a plain
  // Select is unusable. Combobox filters as you type.
  return (
    <Combobox items={branches} value={selected} onValueChange={(v) => v && onChange(v)}>
      <ComboboxInput placeholder="Search branches…" className="h-8 font-mono text-[12.5px]" />
      <ComboboxContent>
        <ComboboxEmpty>No matching branches.</ComboboxEmpty>
        <ComboboxList>
          {(b: string) => (
            <ComboboxItem key={b} value={b} className="font-mono text-[12.5px]">
              {b}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

/**
 * The "check" after binding a source — runs the real `git.inspectRepo`
 * against the bound repo + root. Surfaces a reachable/unreachable verdict and
 * the detected framework, so the operator knows we actually read the repo
 * before they configure the service.
 */
export function RepoCheck({ gitRepoId, root }: { gitRepoId: string; root: string }) {
  const inspect = useQuery({
    ...orpc.git.inspectRepo.queryOptions({
      input: { gitRepoId, path: root || "" },
    }),
    staleTime: 5 * 60 * 1000,
  });

  if (inspect.isLoading) {
    return (
      <div className="mt-2.5 flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2 text-[12px] text-muted-foreground">
        <Spinner className="size-3.5" />
        Checking repository…
      </div>
    );
  }

  if (inspect.isError) {
    return (
      <div className="mt-2.5 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
        Couldn't read the repository
        {root ? (
          <>
            {" "}
            at <span className="font-mono">/{root}</span>
          </>
        ) : null}
        {" — "}
        {inspect.error?.message ?? "check the URL and try again."}
      </div>
    );
  }

  const frameworkKind = (inspect.data?.framework ?? null) as FrameworkKind | null;
  const framework = frameworkLabel(inspect.data?.framework);
  const monorepo = monorepoLabel(inspect.data?.monorepo);

  return (
    <div className="mt-2.5 flex items-center gap-2 rounded-md border border-success/30 bg-success/5 px-3 py-2 text-[12px]">
      {frameworkKind ? (
        <FrameworkLogo framework={frameworkKind} className="size-4 shrink-0" />
      ) : (
        <HugeiconsIcon
          icon={Tick02Icon}
          strokeWidth={2}
          className="size-3.5 shrink-0 text-success"
        />
      )}
      <span className="text-muted-foreground">
        Repository reachable
        {framework ? (
          <>
            {" · detected "}
            <span className="font-medium text-foreground">{framework}</span>
          </>
        ) : (
          " · no framework auto-detected"
        )}
      </span>
      {monorepo && (
        <Badge variant="outline" className="ml-auto font-normal">
          {monorepo}
        </Badge>
      )}
    </div>
  );
}
