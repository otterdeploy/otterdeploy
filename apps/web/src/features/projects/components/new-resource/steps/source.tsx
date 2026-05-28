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

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-form";
import { HugeiconsIcon } from "@hugeicons/react";
import { GitBranchIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import { Link, useParams } from "@tanstack/react-router";
import { toast } from "sonner";

import { SvglLogo } from "@/shared/components/brand/svgl-logo";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { orpc } from "@/shared/server/orpc";

import { SectionHeader } from "../form-primitives";
import { useFormContext } from "../form-context";

export function StepSource() {
  const form = useFormContext();
  // Reactive read — these re-render the step the instant setFieldValue
  // fires from the PublicRepoCTA below.
  const repo = useStore(form.store, (s) => s.values.repo as string);
  const branch = useStore(form.store, (s) => s.values.branch as string);
  const name = useStore(form.store, (s) => s.values.name as string);
  const { orgSlug, projectSlug } = useParams({ strict: false }) as {
    orgSlug: string;
    projectSlug: string;
  };
  const summary = useBindingSummary(projectSlug);
  const boundFullName =
    summary.boundRepoFullNameByGitRepoId[repo] ??
    summary.justBoundFullName ??
    null;

  // setRepo cascades to branch — same pattern as kind.tsx where one
  // pick seeds multiple fields. Keeps the bound-state transition atomic.
  const onPublicRepoBound = (repoId: string, fullName: string) => {
    form.setFieldValue("repo", repoId);
    form.setFieldValue("branch", branch || "main");
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

      <div className="mt-5">
        <SectionHeader title="This service" />
      </div>
      <Card className="mt-2.5 rounded-md">
        <CardContent className="flex flex-col gap-3">
          <form.AppField name="name">
            {(f) => (
              <f.TextField
                label="Service name"
                className="font-mono"
                description={`Internal hostname: ${name || "<name>"}`}
              />
            )}
          </form.AppField>
          <form.AppField name="root">
            {(f) => (
              <f.TextField
                label="Root directory (monorepo)"
                className="font-mono"
                placeholder="apps/web"
                description="Path within the repo — leave blank for repo root"
              />
            )}
          </form.AppField>
          <div className="text-[11px] text-muted-foreground">
            Branch is governed by the project binding (
            <span className="font-mono">{branch || "main"}</span>
            ). Per-service branch overrides will land alongside preview
            environments.
          </div>
        </CardContent>
      </Card>
    </>
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

  const providersQuery = useQuery(
    orpc.git.list.queryOptions({ input: undefined }),
  );
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
    rememberJustBound: (repoId, fullName) =>
      setJustBound({ repoId, fullName }),
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
            <div className="font-mono text-[13px]">
              {props.boundFullName ?? props.repo}
            </div>
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
              <div className="text-[13px] font-semibold">
                No git provider connected
              </div>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Connect the GitHub App for private repos + push deploys. For
                a public repo, paste its URL below — no app install needed.
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
          <PublicRepoCTA
            projectId={props.projectId}
            onBound={props.onBound}
          />
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
            <div className="text-[13px] font-semibold">
              Project has no source binding yet
            </div>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Pick a repo under{" "}
              <span className="font-mono">Settings → Build</span> for full
              push-deploy support, or paste a public URL below for a
              manual-deploy binding right now.
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
    onError: (err) =>
      toast.error(err.message ?? "Failed to persist public-repo binding"),
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
