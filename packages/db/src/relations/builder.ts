/**
 * Shared `RelationsBuilder` helper type for the split relation-graph modules.
 *
 * `defineRelations(schema, (r) => …)` hands its builder callback an `r` typed
 * as `RelationsBuilder<ExtractTablesFromSchema<typeof schema>>`. Each grouped
 * builder function in the sibling domain modules (`./auth`, `./project`,
 * `./infra`) receives that exact type, so the spread-composed result in
 * `./index` infers identically to a single inline object literal.
 */
import type { ExtractTablesFromSchema, RelationsBuilder } from "drizzle-orm";

export type RelationBuilder = RelationsBuilder<ExtractTablesFromSchema<typeof import("../schema")>>;
