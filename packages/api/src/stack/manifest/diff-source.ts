/**
 * Source-block field diffs for the manifest diff — image tag, git binding
 * (repo/branch/subdir/imageRepository/previews) and buildConfig. Split out of
 * diff-helpers.ts to keep it under the file-length cap; internal to the diff
 * and re-imported by diff-helpers.ts.
 */

import type { BuildConfig } from "@otterdeploy/shared/build-config";

import type { CurrentService } from "./diff";
import type { ServiceManifest } from "./schema";

export type FieldChanges = Record<string, { from: unknown; to: unknown }>;

function diffImageSource(
  desired: ServiceManifest,
  current: CurrentService,
  fc: FieldChanges,
): void {
  if (desired.source === "image" && current.source === "image" && desired.image !== current.image) {
    fc.image = { from: current.image, to: desired.image };
  }
}

function diffGitBinding(desired: ServiceManifest, current: CurrentService, fc: FieldChanges): void {
  if (desired.source !== "git" || current.source !== "git") return;

  const desiredSubdir = desired.sourceSubdir ?? null;
  if (desiredSubdir !== current.sourceSubdir) {
    fc.sourceSubdir = { from: current.sourceSubdir, to: desiredSubdir };
  }
  // Per-service repo/branch. Only diffed when the manifest actually declares
  // `repo` — an omitted repo means "leave the existing binding alone" (repo
  // moved into the manifest recently; pre-migration manifests omit it and
  // must not read as "unset the repo"). See manifest-apply-services.ts, which
  // gates the write the same way.
  if (desired.repo !== undefined) {
    if (desired.repo !== current.repo) {
      fc.repo = { from: current.repo, to: desired.repo };
    }
    const desiredBranch = desired.branch ?? null;
    if (desiredBranch !== current.branch) {
      fc.branch = { from: current.branch, to: desiredBranch };
    }
  }
  const desiredImage = desired.imageRepository ?? null;
  if (desired.imageRepository !== undefined && desiredImage !== current.imageRepository) {
    fc.imageRepository = { from: current.imageRepository, to: desiredImage };
  }
  // Declared-only, like publicEnabled: an omitted `previews` key means the
  // toggle is live-managed — defaulting it to false would phantom-revert a
  // live opt-in on the next Apply.
  if (desired.previews !== undefined && desired.previews !== current.previewsEnabled) {
    fc.previewsEnabled = { from: current.previewsEnabled, to: desired.previews };
  }
}

function diffBuildConfigField(
  desired: ServiceManifest,
  current: CurrentService,
  fc: FieldChanges,
): void {
  if (desired.source !== "git") return;
  const desiredBuild = desired.build ?? null;
  if (!sameBuildConfig(desiredBuild, current.buildConfig)) {
    fc.buildConfig = { from: current.buildConfig, to: desiredBuild };
  }
}

export function diffSourceFields(
  desired: ServiceManifest,
  current: CurrentService,
  fc: FieldChanges,
): void {
  diffImageSource(desired, current, fc);
  diffGitBinding(desired, current, fc);
  diffBuildConfigField(desired, current, fc);
}

// Compare buildConfigs semantically, independent of key order. The desired
// side comes from the manifest (keys in insertion order, discriminator
// first); the current side is read back from a postgres `jsonb` column,
// which returns keys in its own normalized order (e.g. `spa` before
// `builder`). A plain `JSON.stringify` comparison would treat
// `{builder,spa}` and `{spa,builder}` as different and surface a permanent
// phantom "update" that can never be applied away or discarded.
function sameBuildConfig(a: BuildConfig | null, b: BuildConfig | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return canonicalJson(a) === canonicalJson(b);
}

// Stable JSON: object keys sorted recursively, array order preserved.
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}
