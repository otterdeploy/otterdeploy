/**
 * The otterd control plane's scheduling and failover core: placement, grant
 * admission and positive-retirement evidence. Pure functions over snapshots;
 * persistence and transport live in the API package.
 */
export * from "./admission";
export * from "./evidence";
export * from "./model";
export * from "./placement";
