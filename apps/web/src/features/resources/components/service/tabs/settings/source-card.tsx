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

import { useEffect, useMemo, useState } from "react";

import { useLiveQuery } from "@tanstack/react-db";
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
import { InstallationField, RepositoryField, useSourceForm } from "./source-card-fields";

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

export function ServiceSourceCard({ resource }: { resource: ServiceBuildResource }) {
  // Current source block from the saved manifest (the source of truth this card
  // edits). Read straight off manifest.get — the same call stageSource writes.
  const manifest = useQuery(
    orpc.project.manifest.get.queryOptions({ input: { id: resource.projectId as never } }),
  );
  const gitSvc = useMemo(() => {
    const svc = manifest.data?.manifest?.services?.[resource.name];
    return svc && svc.source === "git" ? svc : null;
  }, [manifest.data, resource.name]);

  // Installations + repos for the pickers (same endpoints the wizard uses).
  const providersQuery = useQuery(orpc.git.list.queryOptions({ input: undefined }));
  const installations = useMemo(
    () =>
      (providersQuery.data ?? []).flatMap((p) =>
        p.installations.map((inst) => ({ id: inst.id, label: `${p.kind}: ${inst.accountLogin}` })),
      ),
    [providersQuery.data],
  );
  const [activeInstallationId, setActiveInstallationId] = useState<string | null>(null);
  useEffect(() => {
    if (activeInstallationId || installations.length === 0) return;
    setActiveInstallationId(installations[0]?.id ?? null);
  }, [activeInstallationId, installations]);

  const reposQuery = useQuery(
    orpc.git.listRepos.queryOptions({
      input: { installationId: (activeInstallationId ?? "") as never },
      enabled: activeInstallationId != null,
    }),
  );

  // Local edit state (seeded from the manifest source block) + dirty flag.
  const { repo, branch, root, image, setRepo, setBranch, setRoot, setImage, dirty } =
    useSourceForm(gitSvc);

  const saveMut = useMutation({
    mutationFn: () =>
      stageSource(resource, {
        repo: repo.trim() || null,
        branch: branch.trim() || null,
        sourceSubdir: root.trim() || null,
        imageRepository: image.trim() || null,
      }),
    onSuccess: async () => {
      toast.success("Source staged — Deploy to apply");
      await invalidateAfterSave(resource.projectId);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to stage source"),
  });

  // Host-match preview for the image target — surface which shared credential
  // the builder will push with (or that none matches), so it's transparent.
  const { data: registries } = useLiveQuery((q) => q.from({ r: registryCollection }));
  const imageHost = image.trim().split("/")[0] ?? "";
  const matchedRegistry = imageHost ? (registries.find((r) => r.host === imageHost) ?? null) : null;

  const builder =
    (resource.buildConfig as { builder?: string } | null | undefined)?.builder ?? "auto";

  // Ensure the currently-bound repo is always selectable even when it lives in a
  // different installation than the active one (or is a public-URL repo).
  const repoOptions = useMemo(() => {
    const opts = (reposQuery.data ?? []).map((r) => r.fullName);
    if (repo && !opts.includes(repo)) return [repo, ...opts];
    return opts;
  }, [reposQuery.data, repo]);

  // Resolve the bound repo's gitRepoId for the folder picker (it walks the repo
  // via git.inspectRepo). Unresolvable (repo in another installation) → the
  // picker shows its own disabled "(no repo bound)" state.
  const selectedRepoId = useMemo(
    () => reposQuery.data?.find((r) => r.fullName === repo)?.id ?? null,
    [reposQuery.data, repo],
  );

  return (
    <SettingsCard
      title="Source"
      description="Where this service builds from. Pushing to its branch deploys it."
    >
      {/* repo → build → image pipeline strip */}
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

      <div className="mt-3">
        <BuildFieldRow label="Installation" hint="Which connected account owns the repo.">
          <InstallationField
            installations={installations}
            value={activeInstallationId}
            onChange={setActiveInstallationId}
          />
        </BuildFieldRow>

        <BuildFieldRow label="Repository" hint="owner/repo this service builds from.">
          <RepositoryField
            activeInstallationId={activeInstallationId}
            isLoading={reposQuery.isLoading}
            options={repoOptions}
            value={repo}
            onChange={setRepo}
          />
        </BuildFieldRow>

        <BuildFieldRow label="Branch" hint="Pushes here deploy. Empty = repo default.">
          <Input
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="main"
            className="font-mono"
          />
        </BuildFieldRow>

        <BuildFieldRow label="Root directory" hint="Monorepo subfolder. Empty = repo root.">
          <RootDirectoryPicker
            gitRepoId={selectedRepoId}
            value={root}
            onChange={setRoot}
            repoFullName={repo || null}
          />
        </BuildFieldRow>

        <BuildFieldRow
          label="Image target"
          hint="Fully-qualified, no tag. Empty = local build. Credential matched by host."
        >
          <Input
            value={image}
            onChange={(e) => setImage(e.target.value)}
            placeholder="ghcr.io/acme/api"
            className="font-mono"
          />
          {image.trim() && (
            <p
              className={`mt-1 text-[11px] ${matchedRegistry ? "text-muted-foreground" : "text-destructive"}`}
            >
              {matchedRegistry
                ? `Pushes via ${matchedRegistry.displayName} (${matchedRegistry.host}).`
                : `No registry credential for ${imageHost} — add one in Registries or clear this.`}
            </p>
          )}
        </BuildFieldRow>
      </div>

      <SaveRow dirty={dirty} pending={saveMut.isPending} onSave={() => saveMut.mutate()} />
    </SettingsCard>
  );
}
