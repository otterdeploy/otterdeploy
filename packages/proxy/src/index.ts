export {
  getConfig,
  addRoute,
  removeRouteById,
  updateRoute,
  loadConfig,
  healthCheck,
} from "./caddy-client";
export { buildRoute, buildRouteId } from "./config-builder";
export {
  createReverseProxyHandler,
  createCompressionHandler,
  createSecurityHeadersHandler,
} from "./middleware";
export {
  bootstrapCaddy,
  isCaddyRunning,
  restartCaddy,
  getCaddyServiceName,
} from "./container";
export {
  syncResourceProxy,
  syncDomainProxy,
  removeResourceProxy,
  syncServerProxy,
} from "./sync";
export type {
  CaddyRoute,
  CaddyHandler,
  CaddyConfig,
  RouteTarget,
  RouteOpts,
} from "./types";
export type { SyncDeps } from "./sync";
