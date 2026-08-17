import { useLiveQuery } from "@tanstack/react-db";
import { useSelector } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Result } from "better-result";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  return (
    <div className="mx-3 mt-3 flex items-center gap-3 rounded-md border border-border/60 bg-muted/20 px-3 py-2.5">
      <PipeChip
        label={t("resources.source.pipe.repo")}
        value={
          repo
            ? `${repo}@${branch || t("resources.source.pipe.defaultBranch")}`
            : t("resources.source.pipe.notSet")
        }
        muted={!repo}
      />
      <span className="text-muted-foreground/50" aria-hidden>
        →
      </span>
      <PipeChip label={t("resources.source.pipe.build")} value={builder} />
      <span className="text-muted-foreground/50" aria-hidden>
        →
      </span>
      <PipeChip
        label={t("resources.source.pipe.image")}
        value={image.trim() || t("resources.source.pipe.local")}
        muted={!image.trim()}
      />
    </div>
  );
}

/** Host-match preview for the image target: surface which shared credential
 *  the builder will push with (or that none matches), so it's transparent. */
function RegistryHint({
  image,
  registries,
}: {
  image: string;
  registries: { host: string; displayName: string }[];
}) {
  const { t } = useTranslation();
  const imageHost = image.trim().split("/")[0] ?? "";
  const matched = imageHost ? (registries.find((r) => r.host === imageHost) ?? null) : null;
  if (!imageHost) return null;
  return (
    <p className={`mt-1 text-[11px] ${matched ? "text-muted-foreground" : "text-destructive"}`}>
      {matched
        ? t("resources.source.registryMatched", {
            name: matched.displayName,
            host: matched.host,
          })
        : t("resources.source.registryUnmatched", { host: imageHost })}
    </p>
  );
}

export function ServiceSourceCard({ resource }: { resource: ServiceBuildResource }) {
  const { t } = useTranslation();
  // Current source block from the saved manifest (the source of truth this card
  // edits). Read straight off manifest.get. The same call stageSource writes.
  const manifest = useQuery(
    orpc.project.manifest.get.queryOptions({ input: { id: resource.projectId } }),
  );
  const gitSvc = readGitSource(manifest.data, resource.name);

  // Installations + repos for the pickers (same endpoints the wizard uses).
  const providersQuery = useQuery(orpc.git.list.queryOptions({ input: undefined }));
  const installations = (providersQuery.data ?? []).flatMap((p) =>
    p.installations.map((inst) => ({
      id: inst.id,
      label: `${p.kind}: ${inst.accountLogin}`,
      // Carried so the repository field can link out to the right provider.
      kind: p.kind,
    })),
  );
  const [activeInstallationId, setActiveInstallationId] = useActiveInstallation(installations);

  const reposQuery = useQuery(
    orpc.git.listRepos.queryOptions({
      input: { installationId: activeInstallationId ?? "" },
      enabled: activeInstallationId != null,
    }),
  );

  // The saved values this card edits against. Form baseline and dirty check.
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
      toast.success(t("resources.source.staged"));
      await invalidateAfterSave(resource.projectId);
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : t("resources.source.stageFailed")),
  });

  // Re-seeding when the saved source block changes (manifest load, post-save
  // refetch) needs no effect: useForm hands `defaultValues` to `form.update()`
  // on every render, and update() re-seeds when they change. Comparing them
  // structurally, so `seeded` being a fresh object each render costs nothing.
  //
  // It re-seeds only while the form is untouched, which is the behaviour we
  // want and the reason the effect had to go: `form.reset(seeded)` has no such
  // guard, so any manifest refetch mid-edit. The build card on this same tab
  // staging a change, a teammate deploying. Threw away what the operator had
  // typed. Its dep array is also what span the render loop this card was
  // already carrying a workaround for.
  const form = useSourceFormState(seeded, async (value, formApi) => {
    const staged = await Result.tryPromise({
      try: () => saveMut.mutateAsync(value),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    });
    // The mutation's onError has already surfaced the failure. Bailing here
    // just keeps the operator's edits so a retry is one click.
    if (staged.isErr()) return;
    // Staged values are the new baseline. Reset clears `isTouched`, which is
    // what re-arms the automatic re-seed above: a touched form is left alone
    // forever, so without this the card would stop tracking the manifest after
    // the operator's first edit. It also absorbs anything the stage normalised
    // (trimmed whitespace, empty → null), so the Save row settles.
    formApi.reset();
  });

  const values = useSelector(form.store, (s) => s.values);
  const { repo, branch, image } = values;
  const dirty = sourceDirty(values, seeded);

  const { data: registries } = useLiveQuery((q) => q.from({ r: registryCollection }));

  const builder = resource.buildConfig?.builder ?? "auto";

  const options = repoOptions(reposQuery.data, repo);
  const selectedRepoId = boundRepoId(reposQuery.data, repo);

  return (
    <SettingsCard
      title={t("resources.source.title")}
      description={t("resources.source.description")}
    >
      <PipeStrip repo={repo} branch={branch} image={image} builder={builder} />

      <div className="mt-3">
        <BuildFieldRow
          label={t("resources.source.installation")}
          hint={t("resources.source.installationHint")}
        >
          <InstallationField
            installations={installations}
            value={activeInstallationId}
            onChange={setActiveInstallationId}
          />
        </BuildFieldRow>

        <BuildFieldRow
          label={t("resources.source.repository")}
          hint={t("resources.source.repositoryHint")}
        >
          <form.Field name="repo">
            {(field) => (
              <RepositoryField
                activeInstallationId={activeInstallationId}
                installationKind={
                  installations.find((i) => i.id === activeInstallationId)?.kind ?? null
                }
                isLoading={reposQuery.isLoading}
                options={options}
                value={field.state.value}
                onChange={field.handleChange}
              />
            )}
          </form.Field>
        </BuildFieldRow>

        <BuildFieldRow label={t("resources.source.branch")} hint={t("resources.source.branchHint")}>
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

        <BuildFieldRow
          label={t("resources.source.rootDirectory")}
          hint={t("resources.source.rootDirectoryHint")}
        >
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
          label={t("resources.source.imageTarget")}
          hint={t("resources.source.imageTargetHint")}
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
          label={t("resources.source.prPreviews")}
          hint={t("resources.source.prPreviewsHint")}
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
