/**
 * The filter POPOVER's working copy.
 *
 * `Filter` (from `@otterdeploy/data-engine`) is the wire model: what the server
 * compiles. It deliberately has no identity, because two identical filters are
 * the same filter to a WHERE clause.
 *
 * A list being edited in a popover does need identity — React needs a stable
 * key, and a half-typed row with no column yet is indistinguishable from
 * another half-typed row. So the id lives here, on the draft, and is stripped
 * on apply. That keeps a UI concern out of the shared model rather than
 * forking the model to carry one.
 */
import type { Filter, FilterOp } from "@otterdeploy/data-engine";

import { FILTER_OP_META } from "@otterdeploy/data-engine";

export interface DraftFilter extends Filter {
  id: string;
}

/** A fresh row: no column and no operator chosen yet. */
export function newDraftFilter(): DraftFilter {
  return { id: crypto.randomUUID(), column: "", op: "eq", values: [""], enabled: true };
}

export function toDrafts(filters: readonly Filter[]): DraftFilter[] {
  return filters.map((f) => ({ ...f, id: crypto.randomUUID() }));
}

/** Strip the UI's identity before the filter goes over the wire. */
export function toFilters(drafts: readonly DraftFilter[]): Filter[] {
  return drafts.map(({ id: _id, ...filter }) => filter);
}

/** How many operand inputs this operator should show. */
export function operandCount(op: FilterOp): number {
  const { arity } = FILTER_OP_META[op];
  // `-1` is "one or more" (IN lists), which the UI renders as a single
  // comma-separated input rather than a growing list of boxes.
  return arity === -1 ? 1 : arity;
}

/** True when the operator takes a comma-separated list in one input. */
export function isListOp(op: FilterOp): boolean {
  return FILTER_OP_META[op].arity === -1;
}

/** Read one operand slot, tolerating a draft that has not been filled yet. */
export function operandAt(filter: DraftFilter, index: number): string {
  return filter.values[index] ?? "";
}

/** Write one operand slot without disturbing the others. */
export function withOperand(filter: DraftFilter, index: number, value: string): DraftFilter {
  const values = [...filter.values];
  while (values.length <= index) values.push("");
  values[index] = value;
  return { ...filter, values };
}
