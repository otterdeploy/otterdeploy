/**
 * Every server detail tab's route. A server tab is a path segment
 * (`/servers/$serverId/storage`), so the layout's tab strip and every link
 * into a tab (the fleet card, the attention list, the state banner's action)
 * share this table.
 *
 * Platform exists on the control-plane server only: the queues, deploy
 * throughput and component versions it shows describe the install, and the
 * control plane is where they run.
 */
export const SERVER_TABS = [
  "overview",
  "containers",
  "metrics",
  "storage",
  "logs",
  "terminal",
  "settings",
  "platform",
] as const;
export type ServerTab = (typeof SERVER_TABS)[number];

export const SERVER_TAB_PATHS = {
  overview: "/$orgSlug/servers/$serverId",
  containers: "/$orgSlug/servers/$serverId/containers",
  metrics: "/$orgSlug/servers/$serverId/metrics",
  storage: "/$orgSlug/servers/$serverId/storage",
  logs: "/$orgSlug/servers/$serverId/logs",
  terminal: "/$orgSlug/servers/$serverId/terminal",
  settings: "/$orgSlug/servers/$serverId/settings",
  platform: "/$orgSlug/servers/$serverId/platform",
} as const satisfies Record<ServerTab, string>;

/** The Containers tab's own sub-tabs (the control plane's Docker daemon). */
export const CONTAINER_TAB_PATHS = {
  containers: "/$orgSlug/servers/$serverId/containers",
  images: "/$orgSlug/servers/$serverId/containers/images",
  networks: "/$orgSlug/servers/$serverId/containers/networks",
  tasks: "/$orgSlug/servers/$serverId/containers/tasks",
  events: "/$orgSlug/servers/$serverId/containers/events",
} as const;
