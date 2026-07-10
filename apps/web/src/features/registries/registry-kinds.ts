/**
 * Registry kinds — UX sugar over the stored host/username/password row.
 *
 * Nothing here is persisted: the add dialog's kind picker pre-fills the
 * host and adapts field hints, and the cards derive the kind back from
 * the canonical host via `kindForHost` at render time (zero schema
 * change). `brand` is the SvglLogo search key; kinds without a shipped
 * brand SVG (Harbor, Generic) fall back to its monogram.
 *
 * Copy stays honest: otterdeploy authenticates with username +
 * password/token only (docker login semantics). Cloud IAM / metadata
 * auth modes (ECR IAM roles, GCP workload identity, ACR managed
 * identity) are not supported — the hints say what to paste instead.
 */

export type RegistryKind =
  | "dockerhub"
  | "ghcr"
  | "gitlab"
  | "ecr"
  | "gar"
  | "acr"
  | "harbor"
  | "generic";

export interface RegistryKindMeta {
  kind: RegistryKind;
  /** Short label for the picker tile. */
  label: string;
  /** Full name, surfaced as the tile's title/tooltip. */
  fullLabel: string;
  /** SvglLogo `search` key — unknown keys render the monogram fallback. */
  brand: string;
  /** Host to pre-fill on pick; empty when the real host is account-specific. */
  hostPrefill: string;
  /** Placeholder shown when the host can't be pre-filled. */
  hostPlaceholder: string;
  usernamePlaceholder: string;
  usernameHint?: string;
  passwordHint: string;
}

export const REGISTRY_KIND_META: Record<RegistryKind, RegistryKindMeta> = {
  dockerhub: {
    kind: "dockerhub",
    label: "Docker Hub",
    fullLabel: "Docker Hub",
    brand: "Docker",
    hostPrefill: "docker.io",
    hostPlaceholder: "docker.io",
    usernamePlaceholder: "docker-id",
    passwordHint:
      "Use a Docker Hub access token (Account settings → Personal access tokens), not your account password.",
  },
  ghcr: {
    kind: "ghcr",
    label: "GHCR",
    fullLabel: "GitHub Container Registry",
    brand: "GitHub",
    hostPrefill: "ghcr.io",
    hostPlaceholder: "ghcr.io",
    usernamePlaceholder: "github-username",
    passwordHint:
      "Use a GitHub PAT with read:packages (plus write:packages to push) as the password.",
  },
  gitlab: {
    kind: "gitlab",
    label: "GitLab",
    fullLabel: "GitLab Container Registry",
    brand: "GitLab",
    hostPrefill: "registry.gitlab.com",
    hostPlaceholder: "registry.gitlab.com",
    usernamePlaceholder: "gitlab-username",
    passwordHint:
      "Use a deploy token or PAT with read_registry (plus write_registry to push) as the password.",
  },
  ecr: {
    kind: "ecr",
    label: "AWS ECR",
    fullLabel: "Amazon Elastic Container Registry",
    brand: "AWS",
    hostPrefill: "",
    hostPlaceholder: "<account>.dkr.ecr.<region>.amazonaws.com",
    usernamePlaceholder: "AWS",
    usernameHint: "ECR basic auth uses the literal username AWS.",
    passwordHint:
      "Paste the output of `aws ecr get-login-password`. Tokens expire after 12h; IAM-role auth isn't supported yet.",
  },
  gar: {
    kind: "gar",
    label: "GAR",
    fullLabel: "Google Artifact Registry",
    brand: "Google Cloud",
    hostPrefill: "",
    hostPlaceholder: "<region>-docker.pkg.dev",
    usernamePlaceholder: "_json_key",
    usernameHint: "Use _json_key with a service-account key, or oauth2accesstoken.",
    passwordHint:
      "Paste the service-account JSON key (username _json_key), or a short-lived token from `gcloud auth print-access-token` (username oauth2accesstoken).",
  },
  acr: {
    kind: "acr",
    label: "ACR",
    fullLabel: "Azure Container Registry",
    brand: "Azure",
    hostPrefill: "",
    hostPlaceholder: "<name>.azurecr.io",
    usernamePlaceholder: "token-name",
    passwordHint:
      "Use a repository-scoped token or the registry's admin-user credentials. Managed-identity auth isn't supported yet.",
  },
  harbor: {
    kind: "harbor",
    label: "Harbor",
    fullLabel: "Harbor (self-hosted)",
    brand: "Harbor",
    hostPrefill: "",
    hostPlaceholder: "harbor.example.com",
    usernamePlaceholder: "robot$ci-push",
    passwordHint: "Use a robot-account secret (recommended) or a user password.",
  },
  generic: {
    kind: "generic",
    label: "Generic",
    fullLabel: "Generic Docker v2 registry",
    brand: "Registry",
    hostPrefill: "",
    hostPlaceholder: "registry.example.com",
    usernamePlaceholder: "ci-bot",
    passwordHint: "Basic credentials for the registry's Docker v2 endpoint.",
  },
};

/** Picker display order — most common first, escape hatch last. */
export const REGISTRY_KINDS: readonly RegistryKindMeta[] = [
  REGISTRY_KIND_META.dockerhub,
  REGISTRY_KIND_META.ghcr,
  REGISTRY_KIND_META.gitlab,
  REGISTRY_KIND_META.ecr,
  REGISTRY_KIND_META.gar,
  REGISTRY_KIND_META.acr,
  REGISTRY_KIND_META.harbor,
  REGISTRY_KIND_META.generic,
];

/**
 * Derive the kind from a stored (or in-progress) host. Mirrors the
 * server's canonical host shape (lowercase, no scheme). Unknown hosts —
 * including most self-hosted registries — read as generic; "harbor" in
 * the hostname is the only self-hosted heuristic we apply.
 */
export function kindForHost(host: string): RegistryKind {
  const h = host.trim().toLowerCase();
  if (h === "docker.io" || h === "registry-1.docker.io" || h === "hub.docker.com") {
    return "dockerhub";
  }
  if (h === "ghcr.io") return "ghcr";
  if (h === "registry.gitlab.com") return "gitlab";
  if (h === "public.ecr.aws" || /\.dkr\.ecr(?:-fips)?\.[a-z0-9-]+\.amazonaws\.com$/.test(h)) {
    return "ecr";
  }
  if (h === "gcr.io" || h.endsWith(".gcr.io") || h === "pkg.dev" || h.endsWith("docker.pkg.dev")) {
    return "gar";
  }
  if (h.endsWith(".azurecr.io")) return "acr";
  if (h.includes("harbor")) return "harbor";
  return "generic";
}
