/**
 * One interpretation of what a table filter means, shared by every engine.
 *
 * See `types.ts` for the declaration model and the closed operation set. The
 * SQL half lives in `packages/api/src/lib/table`, and the two are pinned
 * against each other by the conformance fixtures in `conformance.ts`.
 */

export { defineFilters, type ColumnFilterFn, type Filters } from "./define";
export { evaluateOp, valueAtKey } from "./evaluate";
export { normalize } from "./normalize";
export type {
  ColKind,
  FilterOp,
  FilterSelection,
  FilterSpec,
  FilterType,
  Scalar,
} from "./types";
export { asInstant, isActive } from "./values";
