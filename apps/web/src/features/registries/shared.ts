/** Shared client-side types and helpers for the registries settings page. */

export interface RegistryView {
  id: string;
  displayName: string;
  host: string;
  username: string;
  authType: "password" | "token";
  createdAt: Date;
  updatedAt: Date;
}

/** Convenience presets surfaced in the "add registry" dialog. */
export const HOST_PRESETS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "ghcr.io", label: "GitHub Container Registry (ghcr.io)" },
  { value: "docker.io", label: "Docker Hub (docker.io)" },
  { value: "registry.gitlab.com", label: "GitLab Registry" },
  { value: "public.ecr.aws", label: "AWS Public ECR" },
];

export function formatRelative(date: Date): string {
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}
