/**
 * Public entry-point for the declarative stack-file primitive.
 *
 *   - schema.ts: zod schema + types for the file shape
 *   - render/:   row-state → StackFile → compose YAML pipeline
 */

export {
  STACK_FILE_SCHEMA_VERSION,
  STACK_DEFAULT_HEALTHCHECK,
  stackFileSchema,
  stackServiceSchema,
  stackOtterdeployExtensionSchema,
  type StackConfig,
  type StackDeploy,
  type StackFile,
  type StackHealthcheck,
  type StackNetwork,
  type StackOtterdeployExtension,
  type StackPort,
  type StackSecret,
  type StackService,
  type StackVolume,
  type StackVolumeMount,
} from "./schema";

export { applyEngineDefaults, renderProjectFromRows, toComposeYaml, unifiedDiff } from "./render";
