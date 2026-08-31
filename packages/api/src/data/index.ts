/**
 * The data runtime: how a statement actually reaches a database.
 *
 * Pairs with `@otterdeploy/data-engine`, which decides WHAT to send. This
 * module owns the parts that need the network — resolving a target, pooling a
 * wire connection, enforcing read-only on the session, executing, decoding, and
 * introspecting.
 */
export { DataError } from "./errors";
export { execute, executeTransaction } from "./execute";
export {
  cachedListColumns,
  listColumns,
  listTables,
  purgeIntrospectionCache,
  tableColumns,
} from "./introspect";
export { listConstraints, listEnums, listIndexes } from "./introspect-objects";
export { connect, type Connection } from "./pool";
export { resolveExternalTarget, resolveManagedTarget, type AccessMode } from "./target";
export { describeConnection, parseConnectionUrl } from "./connection-url";
