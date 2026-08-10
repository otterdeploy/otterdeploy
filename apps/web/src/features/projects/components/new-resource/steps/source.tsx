/**
 * Source step: confirms the project's source binding (gitRepoId +
 * productionBranch) and lets the operator paste a public Git URL on the
 * spot if no installation has been connected.
 *
 * State model: the form's `repo` field is the source of truth for the
 * bound state. It's seeded from the project's gitRepoId at wizard
 * construction (see wizard.tsx defaultValues) and overwritten by
 * `form.setFieldValue("repo", repoId)` whenever the PublicRepoCTA
 * succeeds. The BindingSummary reads the form field via `useStore` so
 * the UI flips from CTA → green confirmation in the same render that
 * setFieldValue fires, no query invalidation in the critical path.
 *
 * The `useBindingSummary` query still loads (a) installations for the
 * "no provider connected" empty state, (b) repo metadata for displaying
 * the bound row's `fullName`. Neither is used to gate the binding
 * check itself.
 *
 * Everything the wizard *derives* from the binding. Service name,
 * monorepo root, service type: lives in `useSourceDefaults`, driven by
 * the field listeners below rather than by effects watching queries.
 */

import { useStore } from "@tanstack/react-form";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";

import { Card, CardContent } from "@/shared/components/ui/card";
import { orpc } from "@/shared/server/orpc";

import { useFormContext } from "../form-context";
import { SectionHeader } from "../form-primitives";
import { RootDirectoryPicker } from "../root-directory-picker";
import { BindingSummary, useBindingSummary } from "./source-binding";
import { useSourceDefaults } from "./source-defaults";
import {
  BranchPicker,
  DetectedFrameworkBadge,
  RepoCheck,
  ServiceTypeSelector,
} from "./source-pickers";

export function StepSource() {
  const form = useFormContext();
  // Reactive read. These re-render the step the instant setFieldValue
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
  // in any installation repo list, and regardless of GitHub rate limits.
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

  const defaults = useSourceDefaults(form);

  // Bind the repo; leave `branch` empty so the BranchPicker below can seed it
  // from the repo's real default branch once `git.listBranches` resolves
  // (forcing "main" here would mask a master/develop default). Both bind paths
  // (picker + public-URL CTA) hand us the fullName, so stash it as the
  // portable "owner/repo" the manifest needs (`repo` holds the opaque
  // gitRepoId). `repoFullName` goes first: writing `repo` is what fires the
  // listener that reads it.
  const onPublicRepoBound = (repoId: string, fullName: string) => {
    form.setFieldValue("repoFullName", fullName);
    form.setFieldValue("repo", repoId);
    summary.rememberJustBound(repoId, fullName);
  };

  return (
    <>
      {/* Headless fields. `repo` and `root` are written programmatically.
          By the binding card and the folder picker below, and TanStack Form
          only dispatches a field's listeners while that field is mounted, so
          these are what make `setFieldValue` the trigger for the
          repo-derived defaults. `onMount` covers a binding the wizard was
          constructed with (project already bound to a repo). */}
      <form.AppField
        name="repo"
        listeners={{
          onMount: ({ value }) => void defaults.onRepoBound(value),
          onChange: ({ value }) => void defaults.onRepoBound(value),
        }}
      >
        {() => null}
      </form.AppField>
      <form.AppField
        name="root"
        listeners={{
          onChange: ({ value }) => void defaults.onRootPicked(value),
          onChangeDebounceMs: 250,
        }}
      >
        {() => null}
      </form.AppField>

      <SectionHeader title="Source" />

      <BindingSummary
        repo={repo}
        branch={branch}
        boundFullName={boundFullName}
        hasInstallations={summary.hasInstallations}
        projectId={summary.projectId}
        orgSlug={orgSlug}
        projectSlug={projectSlug}
        installations={summary.installations}
        onBound={onPublicRepoBound}
        // Drop the binding → BindingSummary re-renders the picker so the
        // operator can point this service at a different repo, and everything
        // derived from the old one goes with it.
        onChangeRepo={defaults.clearBinding}
      />

      {/* Service config only appears once a repo is bound, paste/connect a
          source first, we check it, then this reveals. No point configuring a
          service with nothing to build. */}
      {repo && (
        <>
          <div className="mt-5">
            <SectionHeader title="This service" />
          </div>
          <RepoCheck gitRepoId={repo} root={root} />
          <Card className="mt-2.5 rounded-md">
            <CardContent className="relative flex flex-col gap-3">
              {/* Detected-framework badge: top-right of the card. Glowing comet
                  loader while inspecting, the framework logo once detected. */}
              <DetectedFrameworkBadge
                gitRepoId={repo}
                root={root}
                className="absolute top-3 right-3 z-10"
              />
              <ServiceTypeSelector
                kindId={kindId}
                onChange={(next) => {
                  // The operator chose a type: stop auto-defaulting it from the
                  // detected framework.
                  defaults.pinKind();
                  form.setFieldValue("kindId", next);
                }}
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
                <label className="flex flex-col gap-1.5">
                  <span className="text-[12.5px] font-medium">Root directory (monorepo)</span>
                  <RootDirectoryPicker
                    gitRepoId={repo || null}
                    value={root}
                    repoFullName={boundFullName}
                    // A plain write: it marks the field dirty, which is what
                    // stops the monorepo guess from moving it again, and it
                    // fires the `root` listener above to re-detect there.
                    onChange={(next) => form.setFieldValue("root", next)}
                  />
                </label>
                <p className="text-[11px] text-muted-foreground">
                  Browse the repo to pick the folder for this service. Empty = repo root.
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[12.5px] font-medium">Branch</span>
                  <BranchPicker
                    gitRepoId={repo}
                    value={branch}
                    onChange={(b) => form.setFieldValue("branch", b)}
                  />
                </label>
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
