export {
  MANIFEST_SCHEMA_VERSION,
  manifestSchema,
  serviceSchema,
  databaseSchema,
  type Manifest,
  type ServiceManifest,
  type DatabaseManifest,
  type EnvironmentOverride,
} from "./schema";

// Identity helper for otterdeploy.config.ts authors — gives editor
// autocomplete + a tighter type than `satisfies Manifest` because the
// inferred shape preserves the discriminator narrowing per resource.
// At runtime it's a passthrough; validation happens at the CLI boundary
// via manifestSchema.parse().
export function defineConfig<T extends import("./schema").Manifest>(config: T): T {
  return config;
}

export { resolveEnvironment } from "./merge";

export {
  parseRefs,
  isSecretSentinel,
  ManifestRefError,
  type Ref,
} from "./refs";

export {
  diffManifest,
  type Change,
  type ChangeKind,
  type ChangeResource,
  type CurrentDatabase,
  type CurrentService,
  type CurrentServicePort,
  type CurrentState,
} from "./diff";
