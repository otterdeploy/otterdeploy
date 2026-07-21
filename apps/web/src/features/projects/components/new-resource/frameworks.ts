// Human labels for the framework / monorepo kinds that `git.inspectRepo`
// returns. Shared by the Source and Builder steps so detection copy stays
// consistent.

const FRAMEWORK_LABEL: Record<string, string> = {
  next: "Next.js",
  nuxt: "Nuxt",
  vite: "Vite",
  remix: "Remix",
  astro: "Astro",
  sveltekit: "SvelteKit",
  react: "React",
  vue: "Vue",
  express: "Express",
  fastify: "Fastify",
  hono: "Hono",
  nest: "NestJS",
  node: "Node",
  bun: "Bun",
  go: "Go",
  python: "Python",
  rust: "Rust",
  ruby: "Ruby",
  static: "Static",
};

const MONOREPO_LABEL: Record<string, string> = {
  turbo: "Turborepo",
  nx: "Nx",
  "pnpm-workspace": "pnpm workspaces",
  "yarn-workspace": "yarn workspaces",
  "npm-workspace": "npm workspaces",
  lerna: "Lerna",
};

export function frameworkLabel(kind: string | null | undefined): string | null {
  if (!kind) return null;
  return FRAMEWORK_LABEL[kind] ?? kind;
}

// Frameworks that build to a static bundle (an SPA or pre-rendered site) served
// from the edge by default, rather than a long-running HTTP server. Used to
// pre-select the service type from what we detected — the operator can still
// override it (e.g. a Vite SSR app, or an Astro site with a server adapter).
const STATIC_FRAMEWORKS = new Set(["vite", "react", "vue", "astro", "static"]);

/** Default "Service type" (Web app vs Static site) for a detected framework. */
export function frameworkDefaultServiceType(
  kind: string | null | undefined,
): "app" | "static" {
  return kind && STATIC_FRAMEWORKS.has(kind) ? "static" : "app";
}

// Conventional deployable-app folder names, best first — used to rank a
// monorepo's packages when guessing which one to deploy.
const APP_NAME_RANK = ["web", "app", "www", "frontend", "site", "server", "api", "backend"];

function appRank(pkgPath: string): number {
  const base = pkgPath.split("/").pop() ?? pkgPath;
  const i = APP_NAME_RANK.indexOf(base);
  return i === -1 ? APP_NAME_RANK.length : i;
}

/**
 * Best-guess deployable app in a monorepo, from the detected workspace packages
 * (`inspectRepo.monorepoPackages`). Prefers an `apps/*` folder — that's where
 * deployables live in Turborepo/Nx layouts — then a conventional app name, so
 * the wizard can point the root at the app instead of the empty workspace root.
 * Returns null when there's nothing to pick.
 */
export function pickDefaultMonorepoApp(packages: string[]): string | null {
  if (packages.length === 0) return null;
  const apps = packages.filter((p) => p.startsWith("apps/"));
  const pool = apps.length > 0 ? apps : packages;
  return [...pool].sort((a, b) => appRank(a) - appRank(b))[0] ?? null;
}

export function monorepoLabel(kind: string | null | undefined): string | null {
  if (!kind) return null;
  return MONOREPO_LABEL[kind] ?? kind;
}
