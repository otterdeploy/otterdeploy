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
