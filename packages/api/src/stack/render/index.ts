/**
 * Barrel for the stack-file renderer.
 *
 *   - from-rows.ts:       rows → StackFile
 *   - apply-defaults.ts:  fill engine adapter defaults on database services
 *   - to-compose.ts:      StackFile → compose YAML
 *   - diff.ts:            unified diff over two YAML strings
 */

export { renderProjectFromRows } from "./from-rows";
export { applyEngineDefaults } from "./apply-defaults";
export { toComposeYaml } from "./to-compose";
export { unifiedDiff } from "./diff";
