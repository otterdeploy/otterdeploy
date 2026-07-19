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

import { useEffect, useState } from "react";

import { useLiveQuery } from "@tanstack/react-db";
import { useForm, useStore } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
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

/** The saved manifest source block this card edits (subset we read). */
interface GitSourceBlock {
  repo?: string | null;
  branch?: string | null;
  sourceSubdir?: string | null;
  imageRepository?: string | null;
  previews?: boolean;
}

/** Form values seeded from the saved source block (empty until it loads). */
const seedSource = (svc: GitSourceBlock | null) => ({
  repo: svc?.repo ?? "",
  branch: svc?.branch ?? "",
  root: svc?.sourceSubdir ?? "",
  image: svc?.imageRepository ?? "",
  previews: svc?.previews ?? false,
});

type SourceFormValues = ReturnType<typeof seedSource>;

const sourceDirty = (values: SourceFormValues, seeded: SourceFormValues) =>
  values.repo !== seeded.repo ||
  values.branch !== seeded.branch ||
  values.root !== seeded.root ||
  values.image !== seeded.image ||
  values.previews !== seeded.previews;

/** Form state seeded from the saved source block; submit hands the values to
 *  the caller's stage mutation. */
function useSourceFormState(seeded: SourceFormValues, save: (value: SourceFormValues) => void) {
  return useForm({
    defaultValues: seeded,
    onSubmit: ({ value }) => save(value),
  });
}

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
  const svc = manifest.data?.manifest?.services?.[resource.name];
  const gitSvc = svc && svc.source === "git" ? svc : null;

  // Installations + repos for the pickers (same endpoints the wizard uses).
  const providersQuery = useQuery(orpc.git.list.queryOptions({ input: undefined }));
  const installations = (providersQuery.data ?? []).flatMap((p) =>
    p.installations.map((inst) => ({ id: inst.id, label: `${p.kind}: ${inst.accountLogin}` })),
  );
  const [activeInstallationId, setActiveInstallationId] = useState<string | null>(null);
  // Default to the first installation once the list loads and none is picked.
  // Adjust in render — React bails out when the value is unchanged, so this
  // self-limits instead of chaining an extra render through an effect.
  if (!activeInstallationId && installations.length > 0) {
    setActiveInstallationId(installations[0]?.id ?? null);
  }

  const reposQuery = useQuery(
    orpc.git.listRepos.queryOptions({
      input: { installationId: (activeInstallationId ?? "") },
      enabled: activeInstallationId != null,
    }),
  );

  // Local edit state (seeded from the manifest source block) + dirty flag.
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

  // Ensure the currently-bound repo is always selectable even when it lives in a
  // different installation than the active one (or is a public-URL repo).
  const repoBaseOptions = (reposQuery.data ?? []).map((r) => r.fullName);
  const repoOptions =
    repo && !repoBaseOptions.includes(repo) ? [repo, ...repoBaseOptions] : repoBaseOptions;

  // Resolve the bound repo's gitRepoId for the folder picker (it walks the repo
  // via git.inspectRepo). Unresolvable (repo in another installation) → the
  // picker shows its own disabled "(no repo bound)" state.
  const selectedRepoId = reposQuery.data?.find((r) => r.fullName === repo)?.id ?? null;

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
                options={repoOptions}
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
