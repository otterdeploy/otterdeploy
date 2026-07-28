/**
 * Per-service Source mixer — the repo → build → image pipeline for a git
 * service, edited in one place. Repo binding lives on the SERVICE now (two
 * services in one project can build from two different repos), so this is where
 * it's set: installation → repository → branch → root, plus the optional image
 * target. Every field stages into the service's manifest source block (same
 * pending-changes → Deploy path as the build card) via `stageSource`.
 *
 * The push credential is matched from the shared registry library by the image
 * target's host — the strip surfaces which credential will be used so the
 * host-match is transparent, not magic.
 */

import { useEffect } from "react";

import { useLiveQuery } from "@tanstack/react-db";
import { useStore } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
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
  useSeededSource,
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

/** Host-match preview for the image target — surface which shared credential
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

  // Local edit state (seeded from the manifest source block) + dirty flag.
  // Stable reference — see useSeededSource; seeding inline here is what caused
  // the render loop.
  const seeded = useSeededSource(gitSvc);

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

  const form = useSourceFormState(seeded, (value) => saveMut.mutate(value));

  // Re-seed whenever the saved source block changes (manifest load / post-save
  // refetch) — same reset-to-saved semantics the useState form had.
  useEffect(() => {
    form.reset(seeded);
  }, [form, seeded]);

  const values = useStore(form.store, (s) => s.values);
  const { repo, branch, image } = values;
  const dirty = sourceDirty(values, seeded);

  const { data: registries } = useLiveQuery((q) => q.from({ r: registryCollection }));

  const builder =
    (resource.buildConfig as { builder?: string } | null | undefined)?.builder ?? "auto";

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
