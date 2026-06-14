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

// `ProviderView` / `InstallationView` are inferred from the API contract — see
// ./data/git-providers. Re-exported here so existing import sites keep working.
export type {
  InstallationView,
  ProviderView,
} from "./data/git-providers";

export { formatRelative } from "@otterdeploy/shared/format";
