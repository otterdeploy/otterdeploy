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

import { useEffect, useRef } from "react";

import { useStore } from "@tanstack/react-form";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";

import { Card, CardContent } from "@/shared/components/ui/card";
import { orpc } from "@/shared/server/orpc";

import { useFormContext } from "../form-context";
import { SectionHeader } from "../form-primitives";
import { frameworkDefaultServiceType, pickDefaultMonorepoApp } from "../frameworks";
import { RootDirectoryPicker } from "../root-directory-picker";
import { BindingSummary, useBindingSummary } from "./source-binding";
import {
  BranchPicker,
  deriveServiceName,
  DetectedFrameworkBadge,
  RepoCheck,
  ServiceTypeSelector,
} from "./source-pickers";

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

  // The same repo inspection RepoCheck / the badge run (react-query dedupes on
  // the shared key), used here to pre-select the service type from what we
  // detected: an SPA/static framework (Vite, React, …) → "Static site"; a server
  // framework → "Web app". Only until the operator picks one (kindTouched); we
  // keep the name placeholder in lockstep so derive-from-repo still fires.
  const inspect = useQuery({
    ...orpc.git.inspectRepo.queryOptions({
      input: repo ? { gitRepoId: repo, path: root || "" } : skipToken,
    }),
    staleTime: 5 * 60 * 1000,
  });
  const kindTouched = useRef(false);
  useEffect(() => {
    if (kindTouched.current) return;
    const fw = inspect.data?.framework;
    if (!fw) return;
    const desired = frameworkDefaultServiceType(fw);
    if (desired === kindId) return;
    if (name === kindId) form.setFieldValue("name", desired);
    form.setFieldValue("kindId", desired);
  }, [inspect.data?.framework, kindId, name, form]);

  // Monorepo: the deployable app almost never sits at the repo root, so point
  // the root at the best-guess `apps/*` package (from the detected workspace
  // packages). Detection then re-runs against that folder, so the framework +
  // service type reflect the actual app. Only while the root is still empty and
  // the operator hasn't browsed to a folder themselves.
  const rootTouched = useRef(false);
  useEffect(() => {
    if (rootTouched.current || root !== "" || !inspect.data?.monorepo) return;
    const app = pickDefaultMonorepoApp(inspect.data.monorepoPackages ?? []);
    if (app) form.setFieldValue("root", app);
  }, [inspect.data?.monorepo, inspect.data?.monorepoPackages, root, form]);

  // Bind the repo; leave `branch` empty so the BranchPicker below can seed it
  // from the repo's real default branch once `git.listBranches` resolves
  // (forcing "main" here would mask a master/develop default). Both bind paths
  // (picker + public-URL CTA) hand us the fullName, so stash it as the
  // portable "owner/repo" the manifest needs (`repo` holds the opaque
  // gitRepoId) right here — no derived-state effect.
  const onPublicRepoBound = (repoId: string, fullName: string) => {
    form.setFieldValue("repo", repoId);
    form.setFieldValue("repoFullName", fullName);
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
        installations={summary.installations}
        onBound={onPublicRepoBound}
        onChangeRepo={() => {
          // Drop the binding → BindingSummary re-renders the picker so the
          // operator can point this service at a different repo. Clearing the
          // branch lets it re-seed from the new repo's default, and resetting
          // the name back to the kind placeholder lets the derive-from-repo
          // effect re-run so the service name follows the newly-picked repo
          // (otherwise the old repo's auto-derived name sticks).
          form.setFieldValue("repo", "");
          form.setFieldValue("repoFullName", "");
          form.setFieldValue("branch", "");
          form.setFieldValue("name", kindId);
          form.setFieldValue("root", "");
          // Let the new repo's framework + layout re-default the type and root.
          kindTouched.current = false;
          rootTouched.current = false;
        }}
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
            <CardContent className="relative flex flex-col gap-3">
              {/* Detected-framework badge — top-right of the card. Glowing comet
                  loader while inspecting, the framework logo once detected. */}
              <DetectedFrameworkBadge
                gitRepoId={repo}
                root={root}
                className="absolute top-3 right-3 z-10"
              />
              <ServiceTypeSelector
                kindId={kindId}
                onChange={(next) => {
                  // The operator chose a type — stop auto-defaulting it from the
                  // detected framework.
                  kindTouched.current = true;
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
                    onChange={(next) => {
                      // The operator picked a folder — stop auto-pointing it at
                      // the guessed monorepo app.
                      rootTouched.current = true;
                      form.setFieldValue("root", next);
                    }}
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
