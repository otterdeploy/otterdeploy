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
  customDomain: string | null;
  customDomainVerifiedAt: Date | null;
  gitRepoId: string | null;
  productionBranch: string;
  containerRegistryId: string | null;
  imageRepository: string | null;
}

export interface BindingState {
  customDomain: string;
  gitRepoId: string | null;
  productionBranch: string;
  containerRegistryId: string | null;
  imageRepository: string;
}

function fromProject(project: ProjectBindingFields): BindingState {
  return {
    customDomain: project.customDomain ?? "",
    gitRepoId: project.gitRepoId ?? null,
    productionBranch: project.productionBranch ?? "main",
    containerRegistryId: project.containerRegistryId ?? null,
    imageRepository: project.imageRepository ?? "",
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
  }, [
	project.updatedAt,
	project.id,
	project
]);

  const update = <K extends keyof BindingState>(key: K, value: BindingState[K]) =>
    setState((s) => ({ ...s, [key]: value }));

  const dirty = JSON.stringify(state) !== JSON.stringify(fromProject(project));

  return { state, update, dirty };
}
