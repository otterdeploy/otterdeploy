/**
 * Source-binding summary, public-repo CTA and the read-only loader hook
 * behind the Source step. Split out of source.tsx to keep that file under
 * the max-lines cap. `StepSource` renders `<BindingSummary>` and reads
 * `useBindingSummary`.
 */

import { useState } from "react";

import { GitBranchIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import { toast } from "sonner";

import { SvglLogo } from "@/shared/components/brand/svgl-logo";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { orpc } from "@/shared/server/orpc";

import { RepoPicker, type RepoOwner } from "./repo-picker";

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
export function useBindingSummary(projectSlug: string): {
  hasInstallations: boolean;
  projectId: string | null;
  boundRepoFullNameByGitRepoId: Record<string, string>;
  justBoundFullName: string | null;
  rememberJustBound: (repoId: string, fullName: string) => void;
  installations: RepoOwner[];
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
    installations: installations.map((i) => ({
      id: i.id,
      accountLogin: i.accountLogin,
      accountType: i.accountType,
    })),
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
  installations: RepoOwner[];
  onBound: (repoId: string, fullName: string) => void;
  /** Clear the current binding so the picker reappears — lets the operator
   *  point this service at a different repo. */
  onChangeRepo: () => void;
}

export function BindingSummary(props: BindingSummaryProps) {
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
            <div className="truncate font-mono text-[13px]">
              {props.boundFullName ?? props.repo}
            </div>
            <div className="text-[11px] text-muted-foreground">
              branch <span className="font-mono">{props.branch || "main"}</span>
            </div>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={props.onChangeRepo}>
            Change repo
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!props.hasInstallations) {
    return <NoProviderCard {...props} />;
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
            <div className="text-[13px] font-semibold">Deploy from a repository</div>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Pick a repo from your connected GitHub App, or paste a public URL — no detour to
              Settings needed.
            </p>
          </div>
        </div>

        <RepoPicker
          installations={props.installations}
          projectId={props.projectId}
          onBound={props.onBound}
        />

        <div className="flex items-center gap-2">
          <div className="h-px flex-1 bg-border" />
          <span className="text-[10px] tracking-wider text-muted-foreground uppercase">or</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <PublicRepoCTA projectId={props.projectId} onBound={props.onBound} />
      </CardContent>
    </Card>
  );
}

/**
 * Empty state when the org has no GitHub App installation yet. The Connect
 * link carries a `returnTo` pointing back at this page with `?new=service`,
 * so after the GitHub round-trip the operator lands right back in this
 * wizard instead of stranded on the Git providers page.
 */
function NoProviderCard(props: BindingSummaryProps) {
  const pathname = useLocation({ select: (l) => l.pathname });
  return (
    <Card className="mt-2.5 rounded-md">
      <CardContent className="flex flex-col gap-4 py-4">
        <div className="flex items-start gap-3">
          <SvglLogo search="GitHub" fallback="GitHub" size={24} />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold">No git provider connected</div>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Connect the GitHub App for private repos + push deploys. For a public repo, paste its
              URL below — no app install needed.
            </p>
            <Link
              to="/$orgSlug/git-providers"
              params={{ orgSlug: props.orgSlug }}
              search={{
                git_install: undefined,
                reason: undefined,
                returnTo: `${pathname}?new=service`,
              }}
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

  const connectMut = useMutation({
    ...orpc.git.connectPublicRepo.mutationOptions(),
    onSuccess: (repo) => {
      if (!projectId) return;
      // Repo binds to the SERVICE now (via onBound → service create), not the
      // project.
      onBound(repo.id, repo.fullName);
      setUrl("");
      toast.success(`Bound to ${repo.fullName}`);
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
