/**
 * Compose-stack parsing + deploy mapping. A `type: compose` resource carries a
 * raw compose file; this module turns it into the platform's normal shapes.
 * See docs/designs/compose.md.
 */
export { parseCompose } from "./parse";
export { summarizeCompose } from "./summary";
export {
  composeServiceToSpec,
  composeSwarmServiceName,
  durationMs,
} from "./to-spec";
export type { ComposeSpecContext } from "./to-spec";
export type {
  ParsedBuild,
  ParsedCompose,
  ParsedComposeService,
  ParsedHealthcheck,
  ParsedMount,
  ParsedPort,
  ParsedResources,
  ParsedRestart,
} from "./types";
