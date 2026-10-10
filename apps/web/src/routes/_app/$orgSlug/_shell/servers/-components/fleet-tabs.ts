/**
 * The fleet page's sections and the Docker sub-tabs, as routes.
 */
import type { DockerTab } from "./docker-page-header";

// Each section is a route: Overview (`/servers`), Docker (`/servers/docker`
// and one route per sub-tab) and Install health (`/servers/install-health`).
// The child routes are markers; the fleet layout renders the page and reads
// which section is open.
export const SERVERS_TABS = ["overview", "docker", "install-health"] as const;
export type ServersTab = (typeof SERVERS_TABS)[number];

/**
 * Raw Docker (`docker.*` + `volumes.*`) and Install health
 * (`metrics.platform`) are install-admin in their entirety, so those tabs are
 * omitted for anyone else. Overview is org-scoped
 * (`server.list` / `stats` / `health` / `swarmNodes`) and stays.
 */
const SERVERS_TABS_INSTALL_ADMIN: ReadonlySet<string> = new Set<ServersTab>([
  "docker",
  "install-health",
]);

/** A shared `/servers/docker` link must not reach the plane a hidden trigger
 *  just removed. Otherwise the tab is "hidden" but the 403 is one URL away. */
export function resolveServersTab(tab: ServersTab, isInstallAdmin: boolean): ServersTab {
  if (isInstallAdmin || !SERVERS_TABS_INSTALL_ADMIN.has(tab)) return tab;
  return "overview";
}

export const SERVERS_TAB_PATHS = {
  overview: "/$orgSlug/servers",
  docker: "/$orgSlug/servers/docker",
  "install-health": "/$orgSlug/servers/install-health",
} as const satisfies Record<ServersTab, string>;

export const DOCKER_TAB_PATHS = {
  containers: "/$orgSlug/servers/docker",
  images: "/$orgSlug/servers/docker/images",
  volumes: "/$orgSlug/servers/docker/volumes",
  networks: "/$orgSlug/servers/docker/networks",
  tasks: "/$orgSlug/servers/docker/tasks",
  events: "/$orgSlug/servers/docker/events",
} as const satisfies Record<DockerTab, string>;
