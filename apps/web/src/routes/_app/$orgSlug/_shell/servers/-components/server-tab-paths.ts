/**
 * Every server detail tab's route. A server tab is a path segment
 * (`/servers/$serverId/storage`), so the layout's tab strip and every link
 * into a tab (the fleet card, the attention list, the state banner's action)
 * share this table.
 */
export const SERVER_TABS = [
  "overview",
  "metrics",
  "services",
  "units",
  "storage",
  "logs",
  "terminal",
  "settings",
] as const;
export type ServerTab = (typeof SERVER_TABS)[number];

export const SERVER_TAB_PATHS = {
  overview: "/$orgSlug/servers/$serverId",
  metrics: "/$orgSlug/servers/$serverId/metrics",
  services: "/$orgSlug/servers/$serverId/services",
  units: "/$orgSlug/servers/$serverId/units",
  storage: "/$orgSlug/servers/$serverId/storage",
  logs: "/$orgSlug/servers/$serverId/logs",
  terminal: "/$orgSlug/servers/$serverId/terminal",
  settings: "/$orgSlug/servers/$serverId/settings",
} as const satisfies Record<ServerTab, string>;
