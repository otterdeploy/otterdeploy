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
  "nixpacks",
  "railpack",
  "compose",
] as const;

export type Builder = (typeof BUILDERS)[number];

interface BuildCommon {
  watchPatterns?: string[];
}

/** Auto-detect: inspect the repo (Dockerfile → dockerfile, language
 *  markers → nixpacks, else railpack). No builder-specific knobs. */
export interface BuildAutoConfig extends BuildCommon {
  builder: "auto";
}

/** Build from a Dockerfile. `dockerfilePath` defaults to `./Dockerfile`
 *  (relative to `sourceSubdir` if set). */
export interface BuildDockerfileConfig extends BuildCommon {
  builder: "dockerfile";
  dockerfilePath?: string | null;
}

/** Nixpacks: zero-config builder. `buildCommand` overrides the detected
 *  build step; `nixpacksConfigPath` points at an optional nixpacks.toml. */
export interface BuildNixpacksConfig extends BuildCommon {
  builder: "nixpacks";
  buildCommand?: string | null;
  nixpacksConfigPath?: string | null;
}

/** Railpack: nixpacks-like, different generator. `buildCommand` overrides
 *  the detected build step. */
export interface BuildRailpackConfig extends BuildCommon {
  builder: "railpack";
  buildCommand?: string | null;
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
  | BuildNixpacksConfig
  | BuildRailpackConfig
  | BuildComposeConfig;
