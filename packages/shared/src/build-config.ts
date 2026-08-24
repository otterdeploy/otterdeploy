/**
 * Build configuration for git-sourced services. Discriminated by `builder`;
 * each variant carries only the fields that builder honors.
 *
 * Single source of truth, imported by:
 *   - the zod manifest schema (packages/api/.../manifest/schema.ts)
 *   - the DB column type ($type<>() on service_resource.buildConfig)
 *   - the service handler input/update payloads
 *
 * Keep this file zod-free so it can be consumed from layers that don't
 * (and shouldn't) depend on `@otterdeploy/api`.
 *
 * `watchPatterns` is shared across every variant. Globs against changed
 * paths in a push event; a push only triggers a redeploy when at least
 * one path matches. Unset = redeploy on every push.
 *
 * Variants are type aliases, not interfaces. Aliases keep the implicit
 * index signature that lets a `BuildConfig` assign into `JsonObject`-typed
 * jsonb columns and diff payloads.
 */

export const BUILDERS = ["auto", "dockerfile", "railpack", "compose"] as const;

export type Builder = (typeof BUILDERS)[number];

// Type alias, not interface: aliases keep the implicit index signature that
// makes this assignable to JsonObject/JsonValue (jsonb columns, log events).
// oxlint-disable-next-line typescript/consistent-type-definitions
type BuildCommon = {
  watchPatterns?: string[];
};

/** Auto-detect: inspect the repo (Dockerfile → dockerfile, else railpack).
 *  No builder-specific knobs. */
export type BuildAutoConfig = BuildCommon & {
  builder: "auto";
};

/** Build from a Dockerfile. `dockerfilePath` defaults to `./Dockerfile`
 *  (relative to `sourceSubdir` if set).
 *
 *  `buildArgs` are passed to `docker build` as `--build-arg key=value`. Plain
 *  build-time variables (NOT secrets: they land in the image history, same as
 *  any `--build-arg`). Use them for non-sensitive build toggles; for secrets,
 *  prefer runtime env on the service. Unset = no build-args.
 *
 *  `dockerfileContext` anchors the BUILD CONTEXT, a separate question from
 *  where the Dockerfile lives. A monorepo Dockerfile sits in the app's subdir
 *  but COPYs the root lockfile and the sibling packages it depends on, so it
 *  has to be built from the repo root. `auto` (default) reads the Dockerfile's
 *  COPY sources and escalates to the root only when they demand it; `subdir`
 *  and `root` pin the choice. Ignored when no `sourceSubdir` is set: there is
 *  only one candidate context then. */
export type BuildDockerfileConfig = BuildCommon & {
  builder: "dockerfile";
  dockerfilePath?: string | null;
  buildArgs?: Record<string, string> | null;
  dockerfileContext?: DockerfileContextMode | null;
};

/** Build-context anchor for a Dockerfile that lives in a monorepo subdir. */
export const DOCKERFILE_CONTEXT_MODES = ["auto", "subdir", "root"] as const;

export type DockerfileContextMode = (typeof DOCKERFILE_CONTEXT_MODES)[number];

/** Railpack: zero-config builder. `buildCommand` overrides the detected
 *  build step.
 *
 *  Railpack's static-site provider builds an image that runs Caddy to serve
 *  static assets. `spa` enables single-page-app routing (Caddy falls back to
 *  index.html for unmatched routes) by passing `RAILPACK_SPA_OUTPUT_DIR` to
 *  `railpack prepare`: the env var railpack reads to switch to its static
 *  provider. `staticRoot` sets that directory (defaults to `dist`, the Vite
 *  output): override it for frameworks that emit elsewhere (e.g. CRA's
 *  `build`). Both are honored only when the build is detected/configured as
 *  static.
 *
 *  `packageManager` overrides the repo's `packageManager` field (e.g.
 *  "bun@1.3.13", "pnpm@9.12.0"): the builder rewrites the workspace-root
 *  `package.json` before building, so the pin applies to every manager: bun
 *  resolves its version from that field via mise, while pnpm/yarn/npm are
 *  installed by Corepack, which reads the same field. Use it to escape a repo
 *  pinned to a broken release (e.g. bun 1.3.1's failing native install on Linux
 *  ARM64). Unset = use the repo's own field, or railpack's default if none. */
export type BuildRailpackConfig = BuildCommon & {
  builder: "railpack";
  buildCommand?: string | null;
  spa?: boolean | null;
  staticRoot?: string | null;
  packageManager?: string | null;
  buildRunner?: BuildRunner | null;
  turboFilter?: string | null;
  turboRemoteCache?: boolean | null;
  turboPrune?: boolean | null;
};

/** Which command builds a workspace app.
 *
 *  Turbo is a task RUNNER over a workspace the package manager already defined;
 *  it never creates the workspace. So this only applies once the repo root is
 *  already known to be a workspace and the service lives in a subdir of it.
 *
 *  - `auto`   use turbo when the root has a turbo.json and depends on turbo,
 *             else run the app's own build script (default)
 *  - `turbo`  always `turbo run build --filter=<pkg>`; fails loudly if turbo
 *             isn't usable, rather than silently degrading
 *  - `script` always `cd <subdir> && <pm> run build`, turbo ignored
 *
 *  `turboPrune` builds from a `turbo prune`d copy of the workspace instead of
 *  the whole clone: a smaller build context and, more usefully, an install
 *  narrowed to the packages the app actually reaches. Opt-in, because prune
 *  keeps only the root package.json / lockfile / turbo.json and drops every
 *  other root-level file — a repo whose packages do `extends: "../../
 *  tsconfig.json"` would break. The builder checks for that and silently
 *  declines to prune rather than shipping a broken build. */
export const BUILD_RUNNERS = ["auto", "turbo", "script"] as const;

export type BuildRunner = (typeof BUILD_RUNNERS)[number];

/** Compose: build/orchestrate from a docker-compose file. `composePath`
 *  defaults to `./docker-compose.yml` (relative to `sourceSubdir` if set). */
export type BuildComposeConfig = BuildCommon & {
  builder: "compose";
  composePath?: string | null;
};

export type BuildConfig =
  | BuildAutoConfig
  | BuildDockerfileConfig
  | BuildRailpackConfig
  | BuildComposeConfig;
