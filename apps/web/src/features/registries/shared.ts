/** Shared client-side types and helpers for the registries settings page. */

import type { registryCollection } from "./data/registries";

/** Inferred row type from the collection's `registry.list` projection. */
export type RegistryRow = (typeof registryCollection.toArray)[number];

/** Convenience presets surfaced in the "add registry" dialog. */
export const HOST_PRESETS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "ghcr.io", label: "GitHub Container Registry (ghcr.io)" },
  { value: "docker.io", label: "Docker Hub (docker.io)" },
  { value: "registry.gitlab.com", label: "GitLab Registry" },
  { value: "public.ecr.aws", label: "AWS Public ECR" },
];

export { formatRelative } from "@otterdeploy/shared/format";
