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

import { useEffect } from "react";

import { useStore } from "@tanstack/react-form";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";

import { Card, CardContent } from "@/shared/components/ui/card";
import { orpc } from "@/shared/server/orpc";

import { useFormContext } from "../form-context";
import { SectionHeader } from "../form-primitives";
import { RootDirectoryPicker } from "../root-directory-picker";
import { BindingSummary, useBindingSummary } from "./source-binding";
import { BranchPicker, deriveServiceName, RepoCheck, ServiceTypeSelector } from "./source-pickers";

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
