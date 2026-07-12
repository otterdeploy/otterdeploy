// Shared plumbing for the service build cards: the resource shape, the
// manifest stage/save path, query invalidation, and the two small layout
// atoms (save row + labelled field row). The Railpack and Dockerfile cards in
// `build-card-forms.tsx` build on these.

import type { BuildDockerfileConfig, BuildRailpackConfig } from "@otterdeploy/shared/build-config";

import { Button } from "@/shared/components/ui/button";
import { RESOURCE_COLLECTION_KEY } from "@/features/resources/data/resource";
import { orpc, queryClient } from "@/shared/server/orpc";

export interface ServiceBuildResource {
  projectId: string;
  name: string;
  buildConfig?: unknown;
}

/** Stage `build` for a git service into the manifest. Throws (surfaced via the
 *  caller's toast) if there's no saved manifest or the service isn't git. */
export async function stageBuildConfig(
  resource: ServiceBuildResource,
  nextBuild: BuildRailpackConfig | BuildDockerfileConfig,
): Promise<void> {
  const current = await orpc.project.manifest.get.call({
    id: resource.projectId as never,
  });
  const base = current.manifest;
  if (!base) {
    throw new Error("No manifest saved yet — can't update build settings.");
  }
  const svc = base.services[resource.name];
  if (!svc || svc.source !== "git") {
    throw new Error("Build settings apply only to git-sourced services.");
  }
  const next = {
    ...base,
    services: {
      ...base.services,
      [resource.name]: { ...svc, build: nextBuild },
    },
  };
  await orpc.project.manifest.save.call({
    projectId: resource.projectId as never,
    manifest: next,
    expectedVersion: current.version,
  });
}

/** Stage the git `source` block (repo / branch / subdir / image target) for a
 *  service into the manifest — same pending-changes → Deploy path as the build
 *  card. Throws (surfaced via the caller's toast) if there's no saved manifest
 *  or the service isn't git-sourced. */
export async function stageSource(
  resource: ServiceBuildResource,
  next: {
    repo: string | null;
    branch: string | null;
    sourceSubdir: string | null;
    imageRepository: string | null;
    /** Per-service PR-preview opt-in (manifest `previews`). */
    previews: boolean;
  },
): Promise<void> {
  const current = await orpc.project.manifest.get.call({
    id: resource.projectId as never,
  });
  const base = current.manifest;
  if (!base) {
    throw new Error("No manifest saved yet — can't update the source.");
  }
  const svc = base.services[resource.name];
  if (!svc || svc.source !== "git") {
    throw new Error("Source settings apply only to git-sourced services.");
  }
  const nextManifest = {
    ...base,
    services: {
      ...base.services,
      [resource.name]: {
        ...svc,
        // Schema types `repo` as string|undefined (never null) — omit when cleared.
        repo: next.repo ?? undefined,
        branch: next.branch,
        sourceSubdir: next.sourceSubdir,
        imageRepository: next.imageRepository,
        previews: next.previews,
      },
    },
  };
  await orpc.project.manifest.save.call({
    projectId: resource.projectId as never,
    manifest: nextManifest,
    expectedVersion: current.version,
  });
}

export async function invalidateAfterSave(projectId: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: orpc.project.manifest.diff.queryKey({
        input: { projectId: projectId as never },
      }),
    }),
    queryClient.invalidateQueries({
      queryKey: orpc.project.manifest.get.queryKey({
        input: { id: projectId as never },
      }),
    }),
    queryClient.invalidateQueries({ queryKey: RESOURCE_COLLECTION_KEY }),
  ]);
}

export const trimToNull = (value: string) => {
  const t = value.trim();
  return t.length > 0 ? t : null;
};

export function SaveRow({
  dirty,
  pending,
  onSave,
}: {
  dirty: boolean;
  pending: boolean;
  onSave: () => void;
}) {
  return (
    <div className="flex justify-end px-3 py-2.5">
      <Button type="button" size="sm" disabled={!dirty || pending} onClick={onSave}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}

export function BuildFieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-4 border-b border-border/40 px-3 py-2.5">
      <div className="flex w-40 shrink-0 flex-col pt-1">
        <span className="text-[12px] text-foreground">{label}</span>
        <span className="text-[11px] text-muted-foreground">{hint}</span>
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
