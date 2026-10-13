/**
 * The otterd control plane's scheduling and failover core: placement, grant
 * admission, positive-retirement evidence and the reconcile planner. Pure
 * functions over snapshots; persistence and transport live in the API package.
 */
export * from "./admission";
export * from "./evidence";
export * from "./model";
export * from "./placement";
export * from "./plan";
