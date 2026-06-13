/**
 * Public surface for the resource-detail panels (rendered inside the
 * /graph/$resourceId layout shell).
 *
 * Layout: each resource type owns a folder — `postgres/`, `service/`,
 * `demo/` — holding its `panel.tsx` plus a `tabs/` subtree. Cross-panel
 * helpers (atoms, settings cards, the variables editor, terminal, tasks,
 * shared prop types) live in `_shared/`.
 */

export { PanelIcon, SectionLabel } from "./_shared/atoms";
export { DemoNodePanel } from "./demo/demo-node-panel";
export { SettingsTabBody } from "./demo/demo-settings";
export { NotFound } from "./_shared/not-found";
export {
  METRIC_RANGES,
  MetricsTabBody,
  type MetricRange,
  type MetricsMeta,
} from "./_shared/metrics-tab";
export { PostgresSettingsBody } from "./postgres/tabs/settings";
export { PostgresVariablesTabBody } from "./postgres/tabs/variables";
export { RealResourcePanel } from "./postgres/panel";
export { ResourceTasksTab } from "./_shared/resource-tasks-tab";
export { ServiceResourcePanel } from "./service/panel";
export { ServiceSettingsBody } from "./service/tabs/settings";
export { ServiceVariablesTabBody } from "./service/tabs/variables";
export {
  ResourceTerminal,
  type ResourceTerminalMatch,
} from "./_shared/resource-terminal";
export { TaskLogsTail } from "./_shared/task-logs-tail";
