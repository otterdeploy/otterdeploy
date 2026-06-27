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

export const BUILDERS = ["auto", "dockerfile", "railpack", "compose"] as const;

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
 *  (relative to `sourceSubdir` if set).
 *
 *  `buildArgs` are passed to `docker build` as `--build-arg key=value` — plain
 *  build-time variables (NOT secrets: they land in the image history, same as
 *  any `--build-arg`). Use them for non-sensitive build toggles; for secrets,
 *  prefer runtime env on the service. Unset = no build-args. */
export interface BuildDockerfileConfig extends BuildCommon {
  builder: "dockerfile";
  dockerfilePath?: string | null;
  buildArgs?: Record<string, string> | null;
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
 *  static.
 *
 *  `packageManager` overrides the repo's `packageManager` field (e.g.
 *  "bun@1.3.13", "pnpm@9.12.0") — the builder rewrites the workspace-root
 *  `package.json` before building, so the pin applies to every manager: bun
 *  resolves its version from that field via mise, while pnpm/yarn/npm are
 *  installed by Corepack, which reads the same field. Use it to escape a repo
 *  pinned to a broken release (e.g. bun 1.3.1's failing native install on Linux
 *  ARM64). Unset = use the repo's own field, or railpack's default if none. */
export interface BuildRailpackConfig extends BuildCommon {
  builder: "railpack";
  buildCommand?: string | null;
  spa?: boolean | null;
  staticRoot?: string | null;
  packageManager?: string | null;
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
