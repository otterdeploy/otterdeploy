export {
  MANIFEST_SCHEMA_VERSION,
  manifestSchema,
  serviceSchema,
  databaseSchema,
  composeSchema,
  buildSchema,
  type Manifest,
  type ServiceManifest,
  type DatabaseManifest,
  type ComposeManifest,
  type EnvironmentOverride,
} from "./schema";

// BuildConfig + Builder live in @otterdeploy/shared so layers below the
// api package (db schema, etc.) can use the same definition. Re-exported
// here so callers don't need to dive cross-package.
export {
  BUILDERS,
  type Builder,
  type BuildConfig,
  type BuildAutoConfig,
  type BuildDockerfileConfig,
  type BuildRailpackConfig,
  type BuildComposeConfig,
} from "@otterdeploy/shared/build-config";

// Identity helper for otterdeploy.config.ts authors — gives editor
// autocomplete + a tighter type than `satisfies Manifest` because the
// inferred shape preserves the discriminator narrowing per resource.
// At runtime it's a passthrough; validation happens at the CLI boundary
// via manifestSchema.parse().
export function defineConfig<T extends import("./schema").Manifest>(config: T): T {
  return config;
}

export { resolveEnvironment } from "./merge";

export { parseRefs, isSecretSentinel, ManifestRefError, type Ref } from "./refs";

export {
  declaredEnvOf,
  diffManifest,
  type Change,
  type ChangeKind,
  type ChangeResource,
  type CurrentCompose,
  type CurrentDatabase,
  type CurrentService,
  type CurrentServicePort,
  type CurrentState,
  type DiffOptions,
} from "./diff";
