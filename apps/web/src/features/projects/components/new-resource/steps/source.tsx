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

import { useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-form";
import { HugeiconsIcon } from "@hugeicons/react";
import { GitBranchIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import { Link, useParams } from "@tanstack/react-router";

import { SvglLogo } from "@/shared/components/brand/svgl-logo";
import { Badge } from "@/shared/components/ui/badge";
import { Card, CardContent } from "@/shared/components/ui/card";
import { orpc } from "@/shared/server/orpc";

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

  return (
    <>
      <SectionHeader title="Source" />

      <BindingSummary
        hasInstallations={summary.hasInstallations}
        binding={summary.binding}
        boundRepoFullName={summary.boundRepoFullName}
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
  };
}

interface BindingSummaryProps {
  hasInstallations: boolean;
  binding: { gitRepoId: string | null; productionBranch: string } | null;
  boundRepoFullName: string | null;
  orgSlug: string;
  projectSlug: string;
}

function BindingSummary(props: BindingSummaryProps) {
  if (!props.hasInstallations) {
    return (
      <Card className="mt-2.5 rounded-md">
        <CardContent className="flex items-start gap-3 py-4">
          <SvglLogo search="GitHub" fallback="GitHub" size={24} />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold">
              No git provider connected
            </div>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Connect the GitHub App so this project can pull source. Other
              providers (GitLab, Gitea, …) are on the roadmap.
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
        </CardContent>
      </Card>
    );
  }
  if (!props.binding?.gitRepoId) {
    return (
      <Card className="mt-2.5 rounded-md">
        <CardContent className="flex items-start gap-3 py-4">
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
              Set the git repo, branch, and image target under{" "}
              <span className="font-mono">Settings → Build</span>. Every
              service in this project builds from that binding.
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
