/**
 * Form state + persistence for the build-pipeline binding section of
 * the project settings page. Owns the in-flight edit and exposes a
 * `dirty` flag so the page can disable Save until something's changed.
 */

import { useEffect, useState } from "react";

/**
 * The subset of the project row this section reads. Decoupled from the
 * generated orpc/db types because we only need a handful of fields and
 * threading the full Project type through would force a lot of casts
 * at every consumer (the routeTree types are brand-flavored).
 */
export interface ProjectBindingFields {
  id: string;
  updatedAt: Date;
  gitRepoId: string | null;
  productionBranch: string;
  containerRegistryId: string | null;
  imageRepository: string | null;
  nixpacksConfig: {
    buildCmd?: string;
    startCmd?: string;
    installCmd?: string;
    packages?: string[];
    aptPackages?: string[];
  } | null;
}

export interface BindingState {
  gitRepoId: string | null;
  productionBranch: string;
  containerRegistryId: string | null;
  imageRepository: string;
  buildCmd: string;
  startCmd: string;
  installCmd: string;
  packages: string;
  aptPackages: string;
}

function fromProject(project: ProjectBindingFields): BindingState {
  const nx = fromNixpacksConfig(project.nixpacksConfig);
  return {
    gitRepoId: project.gitRepoId ?? null,
    productionBranch: project.productionBranch ?? "main",
    containerRegistryId: project.containerRegistryId ?? null,
    imageRepository: project.imageRepository ?? "",
    ...nx,
  };
}

function fromNixpacksConfig(cfg: ProjectBindingFields["nixpacksConfig"]) {
  return {
    buildCmd: cfg?.buildCmd ?? "",
    startCmd: cfg?.startCmd ?? "",
    installCmd: cfg?.installCmd ?? "",
    packages: (cfg?.packages ?? []).join(", "),
    aptPackages: (cfg?.aptPackages ?? []).join(", "),
  };
}

export function useBindingFormState(project: ProjectBindingFields) {
  const initial = fromProject(project);
  const [state, setState] = useState<BindingState>(initial);

  // Re-hydrate when the project row updates (e.g. after a successful save
  // refetches). We compare a few of the most-likely-to-change keys to
  // avoid blowing away an in-flight edit on every render.
  useEffect(() => {
    setState(fromProject(project));
    // Tracking the project row's updatedAt is sufficient — every server
    // write bumps it, so the local state hydrates exactly when the
    // server-side picture changes.
  }, [project.updatedAt, project.id]);

  const update = <K extends keyof BindingState>(key: K, value: BindingState[K]) =>
    setState((s) => ({ ...s, [key]: value }));

  const dirty = JSON.stringify(state) !== JSON.stringify(fromProject(project));

  return { state, update, dirty };
}

/**
 * Convert a comma-separated text input back into a string array, or
 * `undefined` for the empty case (we want "[]" and "blank" to be
 * semantically the same — neither writes a package list).
 */
export function csvToList(s: string): string[] | undefined {
  const parts = s
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return parts.length > 0 ? parts : undefined;
}

interface NixpacksPatch {
  buildCmd?: string;
  startCmd?: string;
  installCmd?: string;
  packages?: string[];
  aptPackages?: string[];
}

export function buildNixpacksPatch(s: BindingState): NixpacksPatch | null {
  const patch: NixpacksPatch = {};
  if (s.buildCmd.trim()) patch.buildCmd = s.buildCmd.trim();
  if (s.startCmd.trim()) patch.startCmd = s.startCmd.trim();
  if (s.installCmd.trim()) patch.installCmd = s.installCmd.trim();
  const pkgs = csvToList(s.packages);
  if (pkgs) patch.packages = pkgs;
  const apt = csvToList(s.aptPackages);
  if (apt) patch.aptPackages = apt;
  // Empty config object → null so the column stays NULL rather than
  // persisting `{}`, which would be ambiguous.
  return Object.keys(patch).length > 0 ? patch : null;
}
