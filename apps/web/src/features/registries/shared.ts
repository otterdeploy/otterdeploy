/** Shared client-side types and helpers for the registries settings page. */

import type { registryCollection } from "./data/registries";

/** Inferred row type from the collection's `registry.list` projection. */
export type RegistryRow = (typeof registryCollection.toArray)[number];

export { formatRelative } from "@otterdeploy/shared/format";
