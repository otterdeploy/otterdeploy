import { useLiveQuery } from "@tanstack/react-db";
import { useStore } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Result } from "better-result";
import { toast } from "sonner";

import { RootDirectoryPicker } from "@/features/projects/components/new-resource/root-directory-picker";
import { registryCollection } from "@/features/registries/data/registries";
import { SettingsCard } from "@/features/resources/components/_shared/settings-card";
import { Input } from "@/shared/components/ui/input";
import { orpc } from "@/shared/server/orpc";

import {
  BuildFieldRow,
  invalidateAfterSave,
  SaveRow,
  type ServiceBuildResource,
  stageSource,
} from "./build-card-shared";
import { InstallationField, PreviewsField, RepositoryField } from "./source-card-fields";
import {
  boundRepoId,
  readGitSource,
  repoOptions,
  seedSource,
  sourceDirty,
  useActiveInstallation,
  useSourceFormState,
} from "./source-card-model";

/** One arrow-linked chip in the repo → build → image strip. */
function PipeChip({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[10px] tracking-wide text-muted-foreground/70 uppercase">{label}</span>
      <span
        className={`truncate font-mono text-[12px] ${muted ? "text-muted-foreground" : "text-foreground"}`}
      >
        {value}
      </span>
    </div>
  );
}

/** The repo → build → image pipeline strip. */
function PipeStrip({
  repo,
  branch,
  image,
  builder,
}: {
  repo: string;
  branch: string;
  image: string;
  builder: string;
}) {
  return (
    <div className="mx-3 mt-3 flex items-center gap-3 rounded-md border border-border/60 bg-muted/20 px-3 py-2.5">
      <PipeChip
        label="Repo"
        value={repo ? `${repo}@${branch || "default"}` : "not set"}
        muted={!repo}
      />
      <span className="text-muted-foreground/50" aria-hidden>
        →
      </span>
      <PipeChip label="Build" value={builder} />
      <span className="text-muted-foreground/50" aria-hidden>
        →
      </span>
      <PipeChip label="Image" value={image.trim() || "local"} muted={!image.trim()} />
    </div>
  );
}

/** Host-match preview for the image target — surface which shared credential
 *  the builder will push with (or that none matches), so it's transparent. */
function RegistryHint({
  image,
  registries,
}: {
  image: string;
  registries: { host: string; displayName: string }[];
}) {
  const imageHost = image.trim().split("/")[0] ?? "";
  const matched = imageHost ? (registries.find((r) => r.host === imageHost) ?? null) : null;
  if (!imageHost) return null;
  return (
    <p className={`mt-1 text-[11px] ${matched ? "text-muted-foreground" : "text-destructive"}`}>
      {matched
        ? `Pushes via ${matched.displayName} (${matched.host}).`
        : `No registry credential for ${imageHost} — add one in Registries or clear this.`}
    </p>
  );
}

export function ServiceSourceCard({ resource }: { resource: ServiceBuildResource }) {
  // Current source block from the saved manifest (the source of truth this card
  // edits). Read straight off manifest.get — the same call stageSource writes.
  const manifest = useQuery(
    orpc.project.manifest.get.queryOptions({ input: { id: resource.projectId } }),
  );
  const gitSvc = readGitSource(manifest.data, resource.name);

  // Installations + repos for the pickers (same endpoints the wizard uses).
  const providersQuery = useQuery(orpc.git.list.queryOptions({ input: undefined }));
  const installations = (providersQuery.data ?? []).flatMap((p) =>
    p.installations.map((inst) => ({ id: inst.id, label: `${p.kind}: ${inst.accountLogin}` })),
  );
  const [activeInstallationId, setActiveInstallationId] = useActiveInstallation(installations);

  const reposQuery = useQuery(
    orpc.git.listRepos.queryOptions({
      input: { installationId: activeInstallationId ?? "" },
      enabled: activeInstallationId != null,
    }),
  );

  // The saved values this card edits against — form baseline and dirty check.
  const seeded = seedSource(gitSvc);

  const saveMut = useMutation({
    mutationFn: (value: typeof seeded) =>
      stageSource(resource, {
        repo: value.repo.trim() || null,
        branch: value.branch.trim() || null,
        sourceSubdir: value.root.trim() || null,
        imageRepository: value.image.trim() || null,
        previews: value.previews,
      }),
    onSuccess: async () => {
      toast.success("Source staged — Deploy to apply");
      await invalidateAfterSave(resource.projectId);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to stage source"),
  });

  // Re-seeding when the saved source block changes (manifest load, post-save
  // refetch) needs no effect: useForm hands `defaultValues` to `form.update()`
  // on every render, and update() re-seeds when they change — comparing them
  // structurally, so `seeded` being a fresh object each render costs nothing.
  //
  // It re-seeds only while the form is untouched, which is the behaviour we
  // want and the reason the effect had to go: `form.reset(seeded)` has no such
  // guard, so any manifest refetch mid-edit — the build card on this same tab
  // staging a change, a teammate deploying — threw away what the operator had
  // typed. Its dep array is also what span the render loop this card was
  // already carrying a workaround for.
  const form = useSourceFormState(seeded, async (value, formApi) => {
    const staged = await Result.tryPromise({
      try: () => saveMut.mutateAsync(value),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    });
    // The mutation's onError has already surfaced the failure — bailing here
    // just keeps the operator's edits so a retry is one click.
    if (staged.isErr()) return;
    // Staged values are the new baseline. Reset clears `isTouched`, which is
    // what re-arms the automatic re-seed above: a touched form is left alone
    // forever, so without this the card would stop tracking the manifest after
    // the operator's first edit. It also absorbs anything the stage normalised
    // (trimmed whitespace, empty → null), so the Save row settles.
    formApi.reset();
  });

  const values = useStore(form.store, (s) => s.values);
  const { repo, branch, image } = values;
  const dirty = sourceDirty(values, seeded);

  const { data: registries } = useLiveQuery((q) => q.from({ r: registryCollection }));

  const builder = resource.buildConfig?.builder ?? "auto";

  const options = repoOptions(reposQuery.data, repo);
  const selectedRepoId = boundRepoId(reposQuery.data, repo);

  return (
    <SettingsCard
      title="Source"
      description="Where this service builds from. Pushing to its branch deploys it."
    >
      <PipeStrip repo={repo} branch={branch} image={image} builder={builder} />

      <div className="mt-3">
        <BuildFieldRow label="Installation" hint="Which connected account owns the repo.">
          <InstallationField
            installations={installations}
            value={activeInstallationId}
            onChange={setActiveInstallationId}
          />
        </BuildFieldRow>

        <BuildFieldRow label="Repository" hint="owner/repo this service builds from.">
          <form.Field name="repo">
            {(field) => (
              <RepositoryField
                activeInstallationId={activeInstallationId}
                isLoading={reposQuery.isLoading}
                options={options}
                value={field.state.value}
                onChange={field.handleChange}
              />
            )}
          </form.Field>
        </BuildFieldRow>

        <BuildFieldRow label="Branch" hint="Pushes here deploy. Empty = repo default.">
          <form.Field name="branch">
            {(field) => (
              <Input
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="main"
                className="font-mono"
              />
            )}
          </form.Field>
        </BuildFieldRow>

        <BuildFieldRow label="Root directory" hint="Monorepo subfolder. Empty = repo root.">
          <form.Field name="root">
            {(field) => (
              <RootDirectoryPicker
                gitRepoId={selectedRepoId}
                value={field.state.value}
                onChange={field.handleChange}
                repoFullName={repo || null}
              />
            )}
          </form.Field>
        </BuildFieldRow>

        <BuildFieldRow
          label="Image target"
          hint="Fully-qualified, no tag. Empty = local build. Credential matched by host."
        >
          <form.Field name="image">
            {(field) => (
              <Input
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="ghcr.io/acme/api"
                className="font-mono"
              />
            )}
          </form.Field>
          <RegistryHint image={image} registries={registries} />
        </BuildFieldRow>

        <BuildFieldRow
          label="PR previews"
          hint="Rebuild this service into an isolated preview environment for every pull request."
        >
          <form.Field name="previews">
            {(field) => <PreviewsField checked={field.state.value} onChange={field.handleChange} />}
          </form.Field>
        </BuildFieldRow>
      </div>

      <SaveRow dirty={dirty} pending={saveMut.isPending} onSave={() => void form.handleSubmit()} />
    </SettingsCard>
  );
}
