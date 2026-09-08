import type { db } from "@otterdeploy/db";

/**
 * The database handle a feed runs against.
 *
 * Derived from the real client rather than hand-written, so a driver change
 * shows up here as a type error instead of at runtime in a list endpoint.
 */
export type FeedDatabase = typeof db;
