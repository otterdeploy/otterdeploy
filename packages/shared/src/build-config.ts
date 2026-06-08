/**
 * Build configuration for git-sourced services. Discriminated by `builder`;
 * each variant carries only the fields that builder honors.
 *
 * Single source of truth — imported by:
 *   - the zod manifest schema (packages/api/.../manifest/schema.ts)
 *   - the DB column type ($type<>() on service_resource.buildConfig)
 *   - the service handler input/update payloads
 *
 * Keep this file zod-free so it can be consumed from layers that don't
 * (and shouldn't) depend on `@otterdeploy/api`.
 *
 * `watchPatterns` is shared across every variant — globs against changed
 * paths in a push event; a push only triggers a redeploy when at least
 * one path matches. Unset = redeploy on every push.
 */

export const BUILDERS = [
  "auto",
  "dockerfile",
  "railpack",
  "compose",
] as const;

export type Builder = (typeof BUILDERS)[number];

interface BuildCommon {
  watchPatterns?: string[];
}

/** Auto-detect: inspect the repo (Dockerfile → dockerfile, else railpack).
 *  No builder-specific knobs. */
export interface BuildAutoConfig extends BuildCommon {
  builder: "auto";
}

/** Build from a Dockerfile. `dockerfilePath` defaults to `./Dockerfile`
 *  (relative to `sourceSubdir` if set). */
export interface BuildDockerfileConfig extends BuildCommon {
  builder: "dockerfile";
  dockerfilePath?: string | null;
}

/** Railpack: zero-config builder. `buildCommand` overrides the detected
 *  build step.
 *
 *  Railpack's static-site provider builds an image that runs Caddy to serve
 *  static assets. `spa` enables single-page-app routing (Caddy falls back to
 *  index.html for unmatched routes) by passing `RAILPACK_SPA_OUTPUT_DIR` to
 *  `railpack prepare` — the env var railpack reads to switch to its static
 *  provider. `staticRoot` sets that directory (defaults to `dist`, the Vite
 *  output) — override it for frameworks that emit elsewhere (e.g. CRA's
 *  `build`). Both are honored only when the build is detected/configured as
 *  static. */
export interface BuildRailpackConfig extends BuildCommon {
  builder: "railpack";
  buildCommand?: string | null;
  spa?: boolean | null;
  staticRoot?: string | null;
}

/** Compose: build/orchestrate from a docker-compose file. `composePath`
 *  defaults to `./docker-compose.yml` (relative to `sourceSubdir` if set). */
export interface BuildComposeConfig extends BuildCommon {
  builder: "compose";
  composePath?: string | null;
}

export type BuildConfig =
  | BuildAutoConfig
  | BuildDockerfileConfig
  | BuildRailpackConfig
  | BuildComposeConfig;
