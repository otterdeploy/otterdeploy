/**
 * Canonical framework/language identity for git-sourced services.
 *
 * A service's framework is a static property of its repo — it's detected
 * once, at build time (the builder already clones + analyses the repo), and
 * stored on the service row. The graph and resource panels READ that stored
 * value; they never re-derive it from the git provider's API.
 *
 * Single source of truth — `FRAMEWORK_KINDS` is the one tuple every layer
 * derives from, so the set can't drift:
 *   - the zod enum on the resource contract (packages/api/.../contract/resource.ts)
 *   - the DB column type ($type<FrameworkKind>() on service_resource.framework)
 *   - the builder's detector (apps/builder/src/detect-framework.ts)
 *   - the web's brand-logo map (apps/web/.../framework-logo.tsx)
 *
 * Keep this file zod-free so it can be consumed from layers that don't (and
 * shouldn't) depend on a validation library — mirrors `build-config.ts`.
 */

export const FRAMEWORK_KINDS = [
  "next",
  "nuxt",
  "vite",
  "remix",
  "astro",
  "sveltekit",
  "react",
  "vue",
  "express",
  "fastify",
  "hono",
  "nest",
  "node",
  "bun",
  "go",
  "python",
  "rust",
  "ruby",
  "static",
] as const;

/** A concrete detected framework (non-null). */
export type Framework = (typeof FRAMEWORK_KINDS)[number];

/** Detected framework, or `null` when nothing was detected / never built. */
export type FrameworkKind = Framework | null;

/**
 * Frameworks whose default build artifact is a client-rendered bundle —
 * `vite` here means "vite with no SSR meta-framework on top" (the pkg
 * detector already prefers next/nuxt/remix/astro/sveltekit over vite).
 * These want SPA index.html fallback when served statically.
 */
const SPA_FRAMEWORKS: ReadonlySet<string> = new Set(["vite", "react", "vue"]);

/** String-tolerant: detection results cross API boundaries as plain strings. */
export function isSpaFramework(framework: string | null | undefined): boolean {
  return framework != null && SPA_FRAMEWORKS.has(framework);
}

/**
 * Conventional listen port per server framework. The runtime injects no
 * `PORT` env, so the container port a service exposes must match what the
 * app binds by default — which makes this a lookup, not a question to ask
 * the user. Absent entries (static-artifact frameworks) have no server port.
 */
const FRAMEWORK_DEFAULT_PORTS: Readonly<Partial<Record<Framework, number>>> = {
  next: 3000,
  nuxt: 3000,
  remix: 3000,
  astro: 4321,
  sveltekit: 3000,
  express: 3000,
  fastify: 3000,
  hono: 3000,
  nest: 3000,
  node: 3000,
  bun: 3000,
  go: 8080,
  python: 8000,
  rust: 8080,
  ruby: 3000,
};

/** String-tolerant port lookup; null for unknown/static frameworks. */
export function frameworkDefaultPort(framework: string | null | undefined): number | null {
  if (!framework) return null;
  return FRAMEWORK_DEFAULT_PORTS[framework as Framework] ?? null;
}

/** Minimal shape of a parsed `package.json` the detector needs. */
export interface PackageJsonLike {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * Detect the framework from a parsed `package.json`'s dependency set.
 *
 * Node-only and intentionally finer-grained than railpack's own provider
 * detection (which collapses e.g. astro/express → "node", sveltekit → "vite").
 * Returns "node" for a Node app with no recognised framework, and `null` when
 * there's no `package.json` at all — callers fall back to railpack's
 * language-level detection for non-Node services (go/python/rust/ruby).
 *
 * Order matters: more specific signals win (next before react, sveltekit/
 * remix before vite, etc.).
 */
// oxlint-disable-next-line complexity
export function detectFrameworkFromPkg(pkg: PackageJsonLike | null): FrameworkKind {
  if (!pkg) return null;
  const all = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };
  if (all["next"]) return "next";
  if (all["nuxt"] || all["nuxt3"]) return "nuxt";
  if (all["@remix-run/react"] || all["@remix-run/node"]) return "remix";
  if (all["astro"]) return "astro";
  if (all["@sveltejs/kit"]) return "sveltekit";
  if (all["vite"]) return "vite";
  if (all["@nestjs/core"]) return "nest";
  if (all["hono"]) return "hono";
  if (all["fastify"]) return "fastify";
  if (all["express"]) return "express";
  if (all["vue"]) return "vue";
  if (all["react"]) return "react";
  return "node";
}
