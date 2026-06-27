/**
 * Public surface for the resource-detail panels (rendered inside the
 * /graph/$resourceId layout shell).
 *
 * Layout: each resource type owns a folder — `postgres/`, `service/` —
 * holding its `panel.tsx` plus a `tabs/` subtree. Cross-panel helpers
 * (atoms, settings cards, the variables editor, terminal, tasks, shared
 * prop types) live in `_shared/`.
 */

export { NotFound } from "./_shared/not-found";
export { StagedResourcePanel, type StagedCreate } from "./_shared/staged-panel";
export { RealResourcePanel } from "./postgres/panel";
export type { PostgresBodyProps } from "./postgres/types";
export { ServiceResourcePanel } from "./service/panel";
export { ComposeResourcePanel } from "./compose/panel";
export { ResourceTerminal, type ResourceTerminalMatch } from "./_shared/resource-terminal";
