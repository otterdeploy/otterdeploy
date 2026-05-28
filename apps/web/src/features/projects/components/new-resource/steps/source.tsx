/**
 * Source step — pick the GitHub installation + repo that this service
 * will build from. Backed by orpc.git.list (installations the org has
 * connected) + orpc.git.listRepos (per-installation accessible repos).
 *
 * The project itself owns the *binding* (gitRepoId + productionBranch
 * live on `project`, set under Settings → Build). This step is more of
 * a confirmation: if the project already has a binding we surface it
 * read-only and let the operator override at Settings; if not, we
 * nudge them there. The wizard never writes project.gitRepoId
 * directly — that's a single-source-of-truth boundary.
 *
 * No other providers (GitLab/Gitea/etc.) are shown — the rest of the
 * stack is GitHub-only today. They surface on the Git Providers page
 * as "coming soon" cards and will light up here when the backend ships.
 *
 * The CLI-push and public-Git-URL options were design mocks for a
 * future CLI we don't ship. Removed entirely until they exist.
 */

import { useEffect, useState } from "react";
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
import { orpc, queryClient } from "@/shared/server/orpc";

import { SectionHeader } from "../form-primitives";
import { useFormContext } from "../form-context";

export function StepSource() {
  const form = useFormContext();
  const repo = useStore(form.store, (s) => s.values.repo as string);
  const branch = useStore(form.store, (s) => s.values.branch as string);
  const root = useStore(form.store, (s) => s.values.root as string);
  const name = useStore(form.store, (s) => s.values.name as string);
  const { orgSlug, projectSlug } = useParams({ strict: false }) as {
    orgSlug: string;
    projectSlug: string;
  };
  const summary = useBindingSummary(projectSlug);

  // The wizard's `repo` field was originally written by a per-service
  // repo picker that no longer exists — source binding now lives on the
  // project. Keep the schema's "required" gate satisfied by syncing the
  // bound gitRepoId into the form whenever it appears.
  const boundGitRepoId = summary.binding?.gitRepoId ?? null;
  const productionBranch = summary.binding?.productionBranch ?? "main";
  useEffect(() => {
    if (boundGitRepoId && repo !== boundGitRepoId) {
      form.setFieldValue("repo", boundGitRepoId);
    }
    if (productionBranch && branch !== productionBranch) {
      form.setFieldValue("branch", productionBranch);
    }
  }, [boundGitRepoId, productionBranch, repo, branch, form]);

  return (
    <>
      <SectionHeader title="Source" />

      <BindingSummary
        hasInstallations={summary.hasInstallations}
        binding={summary.binding}
        boundRepoFullName={summary.boundRepoFullName}
        projectId={summary.projectId}
        orgSlug={orgSlug}
        projectSlug={projectSlug}
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
            Branch is governed by the project binding
            {summary.binding ? (
              <>
                {" "}
                (<span className="font-mono">{summary.binding.productionBranch}</span>)
              </>
            ) : null}
            . Per-service branch overrides will land alongside preview
            environments.
          </div>
          {/* Keep `branch` in form state so the schema stays satisfied even
              though the operator can't edit it here. Hidden field. */}
          <input type="hidden" value={branch} readOnly />
          <input type="hidden" value={repo} readOnly />
          <input type="hidden" value={root} readOnly />
        </CardContent>
      </Card>
    </>
  );
}

/**
 * Resolves the project's existing source binding (gitRepoId +
 * productionBranch) plus the human-readable repo name for the binding,
 * so StepSource can render it as a single read-only summary card. All
 * the data-prep noise (multiple useQuery calls, branding coercions)
 * lives here so the step body stays focused on layout.
 */
function useBindingSummary(projectSlug: string): {
  hasInstallations: boolean;
  binding: { gitRepoId: string | null; productionBranch: string } | null;
  boundRepoFullName: string | null;
  projectId: string | null;
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
  const boundRepo = projectBinding?.gitRepoId
    ? repos.find((r) => r.id === projectBinding.gitRepoId)
    : undefined;

  return {
    hasInstallations: installations.length > 0,
    binding: projectBinding
      ? {
          gitRepoId:
            projectBinding.gitRepoId == null
              ? null
              : String(projectBinding.gitRepoId),
          productionBranch: String(projectBinding.productionBranch ?? "main"),
        }
      : null,
    boundRepoFullName: boundRepo?.fullName ?? null,
    projectId: projectBinding?.id ? String(projectBinding.id) : null,
  };
}

interface BindingSummaryProps {
  hasInstallations: boolean;
  binding: { gitRepoId: string | null; productionBranch: string } | null;
  boundRepoFullName: string | null;
  projectId: string | null;
  orgSlug: string;
  projectSlug: string;
}

function BindingSummary(props: BindingSummaryProps) {
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
          <PublicRepoCTA projectId={props.projectId} projectSlug={props.projectSlug} />
        </CardContent>
      </Card>
    );
  }
  if (!props.binding?.gitRepoId) {
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
          <PublicRepoCTA projectId={props.projectId} projectSlug={props.projectSlug} />
        </CardContent>
      </Card>
    );
  }
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
            {props.boundRepoFullName ?? String(props.binding.gitRepoId)}
          </div>
          <div className="text-[11px] text-muted-foreground">
            branch{" "}
            <span className="font-mono">
              {String(props.binding.productionBranch)}
            </span>
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

/**
 * Bind the project to a public Git URL in one shot — connectPublicRepo
 * creates the gitRepo row, project.update writes the binding, then the
 * BindingSummary above re-renders into the "bound" state.
 *
 * Renders nothing when projectId hasn't loaded (the parent query is
 * still flying); avoids a flash of an unbound CTA before we know the
 * project exists.
 */
function PublicRepoCTA({
  projectId,
  projectSlug,
}: {
  projectId: string | null;
  projectSlug: string;
}) {
  const [url, setUrl] = useState("");

  const updateMut = useMutation({
    ...orpc.project.update.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.project.getBySlug.queryKey({
          input: { slug: projectSlug as never },
        }),
      });
      setUrl("");
      toast.success("Public repo bound — ready to configure the service");
    },
    onError: (err) => toast.error(err.message ?? "Failed to bind public repo"),
  });

  const connectMut = useMutation({
    ...orpc.git.connectPublicRepo.mutationOptions(),
    onSuccess: (repo) => {
      if (!projectId) return;
      updateMut.mutate({
        id: projectId as never,
        gitRepoId: repo.id as never,
      });
    },
    onError: (err) => toast.error(err.message ?? "Couldn't use that URL"),
  });

  if (!projectId) return null;

  const submitting = connectMut.isPending || updateMut.isPending;

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
