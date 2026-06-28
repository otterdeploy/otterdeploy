// Build settings for a git-sourced service. Edits the build config and stages
// it into the project manifest — same manifest.get → patch → manifest.save path
// as the danger zone, so the change rides the normal pending-changes bar and
// applies + rebuilds on the next Deploy. Build config only matters at build
// time, so there's no live mutation.
//
// Two shapes, one per builder:
//   - Railpack: package-manager override, build command, static root, SPA.
//     Railpack already detects most of this; the overrides exist to escape a
//     bad/unwanted pin (e.g. a repo stuck on bun@1.3.1, whose native install
//     fails on Linux ARM64).
//   - Dockerfile: the Dockerfile path + `--build-arg`s passed to the build.
//
// The two cards live in `build-card-forms.tsx`; image / compose / auto services
// have no build knobs and render nothing.

import type { BuildDockerfileConfig, BuildRailpackConfig } from "@otterdeploy/shared/build-config";

import type { ServiceBuildResource } from "./build-card-shared";

import { DockerfileBuildCard, RailpackBuildCard } from "./build-card-forms";

/** The resource-list contract types `buildConfig` as `unknown` (consumers that
 *  don't care ignore it), so narrow it here before reading builder fields. */
function asBuilder<T>(buildConfig: unknown, builder: string): T | null {
  return buildConfig != null &&
    typeof buildConfig === "object" &&
    (buildConfig as { builder?: string }).builder === builder
    ? (buildConfig as T)
    : null;
}

/** Dispatch on the builder: railpack and dockerfile each get their own card;
 *  everything else (image / compose / auto) renders nothing. Pure narrowing
 *  only — no hooks — so the sub-components own their own state. */
export function ServiceBuildCard({ resource }: { resource: ServiceBuildResource }) {
  const railpack = asBuilder<BuildRailpackConfig>(resource.buildConfig, "railpack");
  if (railpack) {
    return <RailpackBuildCard resource={resource} config={railpack} />;
  }
  const dockerfile = asBuilder<BuildDockerfileConfig>(resource.buildConfig, "dockerfile");
  if (dockerfile) {
    return <DockerfileBuildCard resource={resource} config={dockerfile} />;
  }
  return null;
}
