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

export function monorepoLabel(kind: string | null | undefined): string | null {
  if (!kind) return null;
  return MONOREPO_LABEL[kind] ?? kind;
}
