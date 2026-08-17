/**
 * Data model behind {@link ServiceSourceCard}: reading the saved git source
 * block out of the manifest, seeding/diffing the form against it, defaulting the
 * installation picker, and resolving the repo option list + the bound repo's id.
 *
 * Split out of source-card.tsx because the card was doing all of this inline.
 * Every `?.` hop and `??` fallback in the derivation counted against one
 * component's branch budget, which put the render well over the complexity cap.
 * Nothing here renders; source-card.tsx stays presentational + wiring.
 */

import { useState } from "react";

import { useForm } from "@tanstack/react-form";

import { orpc } from "@/shared/server/orpc";

type ManifestGet = Awaited<ReturnType<typeof orpc.project.manifest.get.call>>;

/** The saved manifest source block this card edits (subset we read). */
export interface GitSourceBlock {
  repo?: string | null;
  branch?: string | null;
  sourceSubdir?: string | null;
  imageRepository?: string | null;
  previews?: boolean;
}

/** The service's source block from the saved manifest. `null` unless the
 *  service exists AND builds from git, which is the only case this card edits. */
export function readGitSource(data: ManifestGet | undefined, name: string): GitSourceBlock | null {
  const svc = data?.manifest?.services?.[name];
  return svc && svc.source === "git" ? svc : null;
}

/** Form values seeded from the saved source block (empty until it loads). */
export const seedSource = (svc: Partial<GitSourceBlock> | null) => ({
  repo: svc?.repo ?? "",
  branch: svc?.branch ?? "",
  root: svc?.sourceSubdir ?? "",
  image: svc?.imageRepository ?? "",
  previews: svc?.previews ?? false,
});

export type SourceFormValues = ReturnType<typeof seedSource>;

// Historical note: `seedSource` was wrapped in a `useMemo` over its five
// primitives to hand the card a reference that only changed when the saved
// source did. That existed because the card re-seeded through an effect keyed
// on the object: `readGitSource` rebuilds it every render, so the effect
// called `form.reset`, the store write re-rendered, and it looped until React
// gave up with "Maximum update depth exceeded", taking the settings tab with
// it. The effect is gone; TanStack Form compares `defaultValues` structurally,
// so identity no longer decides anything and the memo went with it. Keep it
// that way: if a re-seed ever needs an effect again, the loop comes back.

export const sourceDirty = (values: SourceFormValues, seeded: SourceFormValues) =>
  values.repo !== seeded.repo ||
  values.branch !== seeded.branch ||
  values.root !== seeded.root ||
  values.image !== seeded.image ||
  values.previews !== seeded.previews;

/** Form state seeded from the saved source block; submit hands the values to
 *  the caller's stage mutation, along with the form itself so a successful save
 *  can re-baseline it (see the reset in source-card.tsx). Passing `formApi`
 *  through is what lets the caller avoid reaching back into the `const` this
 *  hook returns from inside its own initialiser. */
export function useSourceFormState(
  seeded: SourceFormValues,
  save: (value: SourceFormValues, form: { reset: () => void }) => void | Promise<void>,
) {
  return useForm({
    defaultValues: seeded,
    onSubmit: ({ value, formApi }) => save(value, formApi),
  });
}

/**
 * The picked git installation, defaulting to the first one once the list loads.
 * Adjusted in render. React bails out when the value is unchanged, so this
 * self-limits instead of chaining an extra render through an effect.
 */
export function useActiveInstallation(installations: readonly { id: string }[]) {
  const [activeInstallationId, setActiveInstallationId] = useState<string | null>(null);
  if (!activeInstallationId && installations.length > 0) {
    setActiveInstallationId(installations[0]?.id ?? null);
  }
  return [activeInstallationId, setActiveInstallationId] as const;
}

/** Repo choices for the picker. The currently-bound repo is always selectable
 *  even when it lives in a different installation than the active one (or is a
 *  public-URL repo), so opening the card can never silently drop the binding. */
export function repoOptions(repos: readonly { fullName: string }[] | undefined, repo: string) {
  const base = (repos ?? []).map((r) => r.fullName);
  return repo && !base.includes(repo) ? [repo, ...base] : base;
}

/** The bound repo's gitRepoId for the folder picker (it walks the repo via
 *  git.inspectRepo). Unresolvable (repo in another installation) → null, and the
 *  picker shows its own disabled "(no repo bound)" state. */
export function boundRepoId(
  repos: readonly { id: string; fullName: string }[] | undefined,
  repo: string,
) {
  return repos?.find((r) => r.fullName === repo)?.id ?? null;
}
