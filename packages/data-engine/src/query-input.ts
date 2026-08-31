import { Result, TaggedError } from "better-result";

/** Validation that prevents stale client state from silently widening a query. */
import type { Filter, ColumnLookup } from "./filters";
import type { Sort } from "./types";

import { isFilterComplete } from "./filters";

export class QueryInputError extends TaggedError("QueryInputError")<{
  reason: "unknown_column" | "incomplete_filter" | "duplicate_column";
  message: string;
}>() {}

export function validateQueryInput(
  input: {
    columns?: readonly string[];
    filters?: readonly Filter[];
    sorts?: readonly Sort[];
  },
  lookup: ColumnLookup,
): Result<void, QueryInputError> {
  const seen = new Set<string>();
  for (const column of input.columns ?? []) {
    if (seen.has(column)) {
      return Result.err(
        new QueryInputError({
          reason: "duplicate_column",
          message: `column "${column}" was selected more than once`,
        }),
      );
    }
    seen.add(column);
    if (lookup.kindOf(column) === undefined) {
      return Result.err(
        new QueryInputError({
          reason: "unknown_column",
          message: `column "${column}" does not exist on this table`,
        }),
      );
    }
  }
  for (const filter of input.filters ?? []) {
    if (!filter.enabled) continue;
    if (lookup.kindOf(filter.column) === undefined) {
      return Result.err(
        new QueryInputError({
          reason: "unknown_column",
          message: `filter column "${filter.column}" does not exist on this table`,
        }),
      );
    }
    if (!isFilterComplete(filter)) {
      return Result.err(
        new QueryInputError({
          reason: "incomplete_filter",
          message: `filter for "${filter.column}" is missing an operand`,
        }),
      );
    }
  }
  for (const sort of input.sorts ?? []) {
    if (lookup.kindOf(sort.column) === undefined) {
      return Result.err(
        new QueryInputError({
          reason: "unknown_column",
          message: `sort column "${sort.column}" does not exist on this table`,
        }),
      );
    }
  }
  return Result.ok(undefined);
}
