/**
 * Source step — confirms the project's source binding (gitRepoId +
 * productionBranch) and lets the operator paste a public Git URL on the
 * spot if no installation has been connected.
 *
 * State model: the form's `repo` field is the source of truth for the
 * bound state. It's seeded from the project's gitRepoId at wizard
 * construction (see wizard.tsx defaultValues) and overwritten by
 * `form.setFieldValue("repo", repoId)` whenever the PublicRepoCTA
 * succeeds. The BindingSummary reads the form field via `useStore` so
 * the UI flips from CTA → green confirmation in the same render that
 * setFieldValue fires — no query invalidation in the critical path.
 *
 * The `useBindingSummary` query still loads (a) installations for the
 * "no provider connected" empty state, (b) repo metadata for displaying
 * the bound row's `fullName`. Neither is used to gate the binding
 * check itself.
 */

import { useEffect, useState } from "react";

import { GitBranchIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useStore } from "@tanstack/react-form";
import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { toast } from "sonner";

import { FrameworkLogo, type FrameworkKind } from "@/features/projects/components/framework-logo";
import { SvglLogo } from "@/shared/components/brand/svgl-logo";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/shared/components/ui/combobox";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Spinner } from "@/shared/components/ui/spinner";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import { useFormContext } from "../form-context";
import { SectionHeader } from "../form-primitives";
import { frameworkLabel, monorepoLabel } from "../frameworks";
import { RootDirectoryPicker } from "../root-directory-picker";

export function StepSource() {
  const form = useFormContext();
  // Reactive read — these re-render the step the instant setFieldValue
  // fires from the PublicRepoCTA below.
  const repo = useStore(form.store, (s) => s.values.repo as string);
  const branch = useStore(form.store, (s) => s.values.branch as string);
  const root = useStore(form.store, (s) => s.values.root as string);
  const name = useStore(form.store, (s) => s.values.name as string);
  const kindId = useStore(form.store, (s) => s.values.kindId as string);
  const { orgSlug, projectSlug } = useParams({ strict: false }) as {
    orgSlug: string;
    projectSlug: string;
  };
  const summary = useBindingSummary(projectSlug);
  // Resolve the bound repo's owner/repo from the DB (no GitHub call), so the
  // binding card shows the real name even for public-URL bindings that aren't
  // in any installation repo list — and regardless of GitHub rate limits.
  // Without this it falls back to the raw gitRepo_… id.
  const repoMeta = useQuery({
    ...orpc.git.getRepo.queryOptions({
      input: repo ? { gitRepoId: repo } : skipToken,
    }),
    staleTime: 5 * 60 * 1000,
  });
  const boundFullName =
    summary.boundRepoFullNameByGitRepoId[repo] ??
    summary.justBoundFullName ??
    repoMeta.data?.fullName ??
    null;

  // Default the service name from the repo once one is bound. `kind.tsx`
  // seeds `name` with the kind id (e.g. "app") as a placeholder; we only
  // override that auto-default (or an empty value), never a name the user
  // actually typed.
  useEffect(() => {
    if (!repo || !boundFullName) return;
    if (name && name !== kindId) return;
    const derived = deriveServiceName(boundFullName);
    if (derived && derived !== name) form.setFieldValue("name", derived);
  }, [repo, boundFullName, name, kindId, form]);

  // Bind the repo; leave `branch` empty so the BranchPicker below can seed it
  // from the repo's real default branch once `git.listBranches` resolves
  // (forcing "main" here would mask a master/develop default).
  const onPublicRepoBound = (repoId: string, fullName: string) => {
    form.setFieldValue("repo", repoId);
    summary.rememberJustBound(repoId, fullName);
  };

  return (
    <>
      <SectionHeader title="Source" />

      <BindingSummary
        repo={repo}
        branch={branch}
        boundFullName={boundFullName}
        hasInstallations={summary.hasInstallations}
        projectId={summary.projectId}
        orgSlug={orgSlug}
        projectSlug={projectSlug}
        onBound={onPublicRepoBound}
      />

      {/* Service config only appears once a repo is bound — paste/connect a
          source first, we check it, then this reveals. No point configuring a
          service with nothing to build. */}
      {repo && (
        <>
          <div className="mt-5">
            <SectionHeader title="This service" />
          </div>
          <RepoCheck gitRepoId={repo} root={root} />
          <Card className="mt-2.5 rounded-md">
            <CardContent className="flex flex-col gap-3">
              <ServiceTypeSelector
                kindId={kindId}
                onChange={(next) => form.setFieldValue("kindId", next)}
              />
              <form.AppField name="name">
                {(f) => (
                  <f.TextField
                    label="Service name"
                    className="font-mono"
                    description={`Internal hostname: ${name || "<name>"}`}
                  />
                )}
              </form.AppField>
              <div className="flex flex-col gap-1.5">
                <label className="text-[12.5px] font-medium">Root directory (monorepo)</label>
                <RootDirectoryPicker
                  gitRepoId={repo || null}
                  value={root}
                  repoFullName={boundFullName}
                  onChange={(next) => form.setFieldValue("root", next)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Browse the repo to pick the folder for this service. Empty = repo root.
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[12.5px] font-medium">Branch</label>
                <BranchPicker
                  gitRepoId={repo}
                  value={branch}
                  onChange={(b) => form.setFieldValue("branch", b)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Deploys track this branch. Manual-deploy bindings redeploy on demand; push deploys
                  fire on commits to it.
                </p>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}

/**
 * Workload-type picker for a git-sourced service. Source and role are
 * orthogonal — you can build a web app OR a static site from the same repo —
 * so the role lives here as a field rather than as a top-level launch card.
 * Drives `kindId` directly: "app" (dynamic) ↔ "static". `to-manifest` reads
 * the static kind to emit a Caddy static build; everything else is a normal
 * railpack app. Worker / cron / one-off jobs aren't distinctly wired yet.
 */
function ServiceTypeSelector({
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
      <label className="text-[12.5px] font-medium">Service type</label>
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
function deriveServiceName(fullName: string): string {
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
function BranchPicker({
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
function RepoCheck({ gitRepoId, root }: { gitRepoId: string; root: string }) {
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

/**
 * Read-only loader for everything the step needs alongside the form:
 *   - installations list (for the "no provider connected" empty state)
 *   - bound-repo fullName lookup keyed by gitRepoId
 *   - a tiny in-memory store of "just-bound" fullName so the green
 *     confirmation shows the actual repo name immediately, without
 *     waiting for the project query to refetch.
 *
 * `projectId` is included so the PublicRepoCTA can call project.update.
 */
function useBindingSummary(projectSlug: string): {
  hasInstallations: boolean;
  projectId: string | null;
  boundRepoFullNameByGitRepoId: Record<string, string>;
  justBoundFullName: string | null;
  rememberJustBound: (repoId: string, fullName: string) => void;
} {
  const projectQuery = useQuery({
    ...orpc.project.getBySlug.queryOptions({
      input: { slug: projectSlug as never },
    }),
    enabled: Boolean(projectSlug),
  });
  const projectBinding = projectQuery.data;

  const providersQuery = useQuery(orpc.git.list.queryOptions({ input: undefined }));
  const providers = providersQuery.data ?? [];
  const installations = providers.flatMap((p) => p.installations);
  const activeInstallationId = installations[0]?.id ?? null;

  const reposQuery = useQuery(
    orpc.git.listRepos.queryOptions({
      input: { installationId: (activeInstallationId ?? "") as never },
      enabled: activeInstallationId != null,
    }),
  );
  const repos = reposQuery.data ?? [];

  const [justBound, setJustBound] = useState<{
    repoId: string;
    fullName: string;
  } | null>(null);

  const boundRepoFullNameByGitRepoId: Record<string, string> = {};
  for (const r of repos) boundRepoFullNameByGitRepoId[r.id] = r.fullName;
  if (justBound) {
    boundRepoFullNameByGitRepoId[justBound.repoId] = justBound.fullName;
  }

  return {
    hasInstallations: installations.length > 0,
    projectId: projectBinding?.id ? String(projectBinding.id) : null,
    boundRepoFullNameByGitRepoId,
    justBoundFullName: justBound?.fullName ?? null,
    rememberJustBound: (repoId, fullName) => setJustBound({ repoId, fullName }),
  };
}

interface BindingSummaryProps {
  /** Current value of form.values.repo. Non-empty = bound. */
  repo: string;
  branch: string;
  boundFullName: string | null;
  hasInstallations: boolean;
  projectId: string | null;
  orgSlug: string;
  projectSlug: string;
  onBound: (repoId: string, fullName: string) => void;
}

function BindingSummary(props: BindingSummaryProps) {
  // Form-state-driven: a non-empty `repo` means the project is bound,
  // whether that came from the initial seed or from this session's
  // PublicRepoCTA. No query refetch sits in the critical path.
  if (props.repo) {
    return (
      <Card className="mt-2.5 rounded-md">
        <CardContent className="flex items-center gap-3 py-3">
          <HugeiconsIcon
            icon={Tick02Icon}
            strokeWidth={2}
            className="size-4 shrink-0 text-success"
          />
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[13px]">{props.boundFullName ?? props.repo}</div>
            <div className="text-[11px] text-muted-foreground">
              branch <span className="font-mono">{props.branch || "main"}</span>
              {" · "}registry binding lives on the project
            </div>
          </div>
          <Badge variant="outline" className="font-normal">
            Project binding
          </Badge>
        </CardContent>
      </Card>
    );
  }

  if (!props.hasInstallations) {
    return (
      <Card className="mt-2.5 rounded-md">
        <CardContent className="flex flex-col gap-4 py-4">
          <div className="flex items-start gap-3">
            <SvglLogo search="GitHub" fallback="GitHub" size={24} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold">No git provider connected</div>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Connect the GitHub App for private repos + push deploys. For a public repo, paste
                its URL below — no app install needed.
              </p>
              <Link
                to="/$orgSlug/git-providers"
                params={{ orgSlug: props.orgSlug }}
                search={{ git_install: undefined, reason: undefined }}
                className="mt-2 inline-block text-[12px] font-medium underline"
              >
                Connect GitHub →
              </Link>
            </div>
          </div>
          <PublicRepoCTA projectId={props.projectId} onBound={props.onBound} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mt-2.5 rounded-md">
      <CardContent className="flex flex-col gap-4 py-4">
        <div className="flex items-start gap-3">
          <HugeiconsIcon
            icon={GitBranchIcon}
            strokeWidth={2}
            className="size-5 shrink-0 text-muted-foreground"
          />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold">Project has no source binding yet</div>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Pick a repo under <span className="font-mono">Settings → Build</span> for full
              push-deploy support, or paste a public URL below for a manual-deploy binding right
              now.
            </p>
            <Link
              to="/$orgSlug/$projectSlug/settings"
              params={{
                orgSlug: props.orgSlug,
                projectSlug: props.projectSlug as never,
              }}
              className="mt-2 inline-block text-[12px] font-medium underline"
            >
              Open Build settings →
            </Link>
          </div>
        </div>
        <PublicRepoCTA projectId={props.projectId} onBound={props.onBound} />
      </CardContent>
    </Card>
  );
}

/**
 * Connect a public Git URL: creates the gitRepo row server-side, then
 * persists the binding on the project. On success we hand the new
 * gitRepoId back to the parent (it owns the form) — the parent's
 * `setFieldValue` write is what flips BindingSummary's render branch.
 *
 * No query invalidation in the success path; the parent already
 * reflects the new state from form state. The query will catch up on
 * its own refetch or on the next navigation.
 */
function PublicRepoCTA({
  projectId,
  onBound,
}: {
  projectId: string | null;
  onBound: (repoId: string, fullName: string) => void;
}) {
  const [url, setUrl] = useState("");

  const updateMut = useMutation({
    ...orpc.project.update.mutationOptions(),
    onError: (err) => toast.error(err.message ?? "Failed to persist public-repo binding"),
  });

  const connectMut = useMutation({
    ...orpc.git.connectPublicRepo.mutationOptions(),
    onSuccess: (repo) => {
      if (!projectId) return;
      onBound(repo.id, repo.fullName);
      setUrl("");
      toast.success(`Bound to ${repo.fullName}`);
      updateMut.mutate({
        id: projectId as never,
        gitRepoId: repo.id as never,
      });
    },
    onError: (err) => toast.error(err.message ?? "Couldn't use that URL"),
  });

  if (!projectId) return null;

  const submitting = connectMut.isPending;

  return (
    <div className="rounded-md border border-dashed border-border/60 bg-muted/20 p-3">
      <Label htmlFor="wizard-public-url" className="text-[12px]">
        Public Git URL
      </Label>
      <div className="mt-1.5 flex gap-2">
        <Input
          id="wizard-public-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://github.com/owner/repo.git"
          className="h-8 font-mono text-[12px]"
          disabled={submitting}
        />
        <Button
          type="button"
          size="sm"
          className="h-8 text-[12px]"
          disabled={!url.trim() || submitting}
          onClick={() => connectMut.mutate({ cloneUrl: url.trim() })}
        >
          {submitting ? "Binding…" : "Use"}
        </Button>
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        HTTPS only. Public-URL bindings deploy manually (no push webhook).
      </p>
    </div>
  );
}
