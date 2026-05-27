export type ProviderKind = "github" | "gitlab" | "gitea" | "bitbucket";

export const PROVIDER_LABEL: Record<ProviderKind, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  gitea: "Gitea",
  bitbucket: "Bitbucket",
};

export const PROVIDER_SEARCH: Record<ProviderKind, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  gitea: "Gitea",
  bitbucket: "Bitbucket",
};

// Providers with backend support today; others render as
// "coming soon" placeholders.
export const SUPPORTED_KINDS = new Set<ProviderKind>(["github"]);

export interface InstallationView {
  id: string;
  installationId: string;
  accountLogin: string;
  accountType: "user" | "organization";
  accountAvatarUrl: string | null;
  repoSelection: "all" | "selected";
  suspendedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  repoCount: number;
}

export interface ProviderView {
  id: string;
  kind: ProviderKind;
  displayName: string;
  installations: InstallationView[];
  createdAt: Date;
}

export function formatRelative(date: Date): string {
  const ms = Date.now() - new Date(date).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
