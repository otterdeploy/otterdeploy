/**
 * The data runtime: how a statement actually reaches a database.
 *
 * Pairs with `@otterdeploy/data-engine`, which decides WHAT to send. This
 * module owns the parts that need the network — resolving a target, pooling a
 * wire connection, enforcing read-only on the session, executing, decoding, and
 * introspecting.
 */
export { decodeDeclared, decodeInferred, decodeRow } from "./decode";
export { DataError, type DataErrorReason, toDataError } from "./errors";
export { execute, executeTransaction, MAX_ROWS, type ExecuteOptions } from "./execute";
export { listColumns, listTables, type TableColumns } from "./introspect";
export { closeAllPools, connect, evict, openPoolKeys, type Connection } from "./pool";
export { resolveManagedTarget, type AccessMode, type DataTarget } from "./target";
