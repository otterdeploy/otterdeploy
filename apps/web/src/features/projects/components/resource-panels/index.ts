/**
 * Panels rendered inside the resource-detail layout.
 *
 * Each panel owns one tab body (Variables, Settings, Logs, etc.) and
 * carries its own helpers. Shared types live in `./types`. The layout
 * shell at `../layout.tsx` is the orchestrator — it composes panels
 * and handles routing / state that crosses panels.
 */

export { PanelIcon, SectionLabel } from "./atoms";
export { DemoNodePanel } from "./demo-node-panel";
export { SettingsTabBody } from "./demo-settings";
export { NotFound } from "./not-found";
export {
  METRIC_RANGES,
  MetricsTabBody,
  type MetricRange,
  type MetricsMeta,
} from "./metrics-tab";
export { PostgresSettingsBody } from "./postgres-settings";
export { PostgresVariablesTabBody } from "./postgres-variables";
export { RealResourcePanel } from "./real-resource-panel";
export { ResourceTasksTab } from "./resource-tasks-tab";
export { ServiceResourcePanel } from "./service-resource-panel";
export {
  ResourceTerminal,
  type ResourceTerminalMatch,
} from "./resource-terminal";
export { TaskLogsTail } from "./task-logs-tail";
export type { ResourceBodyProps } from "./types";
