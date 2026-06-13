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
export function detectFrameworkFromPkg(
  pkg: PackageJsonLike | null,
): FrameworkKind {
  if (!pkg) return null;
  const all = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
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
