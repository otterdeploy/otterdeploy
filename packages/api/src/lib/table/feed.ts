/**
 * One server-paginated list endpoint, assembled from declared filter semantics.
 *
 * A feed handler owns the four things every list surface in the product needs
 * and every one of them used to hand-roll: the WHERE clause, the counts, the
 * facets, and a cursor page that does not lose rows.
 *
 * The tenant scope is deliberately NOT part of the filter path. It is composed
 * from the caller's context on every pass, so no filter value — however
 * malformed, however hand-edited into a URL — can widen a query beyond the
 * organization it was issued for.
 */

import type { FilterSelection, Filters } from "@otterdeploy/shared/table-filters";
import type { SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

import { and, asc, count, desc, sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";

import type { Facets } from "./facets";
import type { FeedDirection } from "./pagination";
import type { ColumnMap } from "./sql";
import type { FeedDatabase } from "./types";

import { computeFacets } from "./facets";
import { overfetch, planCursor, snapPage } from "./pagination";
import { allOf, buildWhere } from "./sql";

export interface FeedSort {
  key: string;
  desc: boolean;
}

/** Extra projected fields: joins, computed SQL, columns nothing filters on. */
export type ExtraSelect = Record<string, PgColumn | SQL | SQL.Aliased>;

export interface FeedConfig {
  db: FeedDatabase;
  table: PgTable;
  /** Declared semantics — the same declaration the client filters with. */
  filters: Filters;
  /** Filter key → column. Doubles as the projection, so rows come back keyed by filter key. */
  columns: ColumnMap;
  /** Filter key rows are paged by. Must be a timestamp column. */
  cursorKey: string;
  /**
   * Filter key rows are ordered by LAST, breaking ties on the cursor. Must be
   * unique; defaults to the table's single-column primary key.
   */
  tiebreakKey?: string;
  select?: ExtraSelect;
  defaultSize?: number;
}

export interface FeedRequest {
  /** Filter values, exactly as the client holds them. Untrusted. */
  values: Record<string, unknown>;
  /** Tenant scope, composed by the caller. Applied to every pass. */
  scope: readonly SQL[];
  sort?: FeedSort | null;
  cursor?: number | null;
  direction?: FeedDirection;
  size?: number;
  /**
   * Facets and counts are identical for a fixed filter set, so pagination
   * requests skip them: the client already holds the first page's copy.
   */
  includeFacets?: boolean;
}

/**
 * Everything a feed returns except the rows themselves, whose type is inferred
 * from the projection rather than declared (and so never asserted).
 */
export interface FeedMeta {
  /** Cursor for the next (older) page. `null` at the end of the feed. */
  nextCursor: number | null;
  /** Cursor for the previous (newer) page — live tailing reads this. */
  prevCursor: number | null;
  /** Rows in scope, before filters. `null` when facets were skipped. */
  totalRowCount: number | null;
  /** Rows matching the active filters. `null` when facets were skipped. */
  filterRowCount: number | null;
  facets: Facets;
  /** The predicates the filtered set was built from, for follow-up aggregates. */
  where: readonly SQL[];
  /** The same, minus the sliders — what slider bounds are computed over. */
  whereWithoutSliders: readonly SQL[];
}

/** The table's primary key, when it is a single column — the default tiebreak. */
function singleColumnPrimaryKey(table: PgTable): PgColumn | undefined {
  const config = getTableConfig(table);
  const inline = config.columns.filter((column) => column.primary);
  if (inline.length === 1) return inline[0];
  if (config.primaryKeys.length !== 1) return undefined;
  const composite = config.primaryKeys[0]?.columns;
  return composite?.length === 1 ? composite[0] : undefined;
}

/** Group the declared keys by the pass each belongs to. */
function passKeys(filters: Filters) {
  const sliderKeys: string[] = [];
  const dateKeys: string[] = [];
  const facetKeys: string[] = [];
  for (const spec of filters.specs) {
    if (spec.type === "slider") {
      sliderKeys.push(spec.key);
      facetKeys.push(spec.key);
    }
    if (spec.type === "checkbox") facetKeys.push(spec.key);
    if (spec.type === "timerange") dateKeys.push(spec.key);
  }
  return { sliderKeys, dateKeys, facetKeys };
}

function cursorMillis(row: unknown, key: string): number | null {
  if (typeof row !== "object" || row === null || !Object.hasOwn(row, key)) return null;
  const value: unknown = Reflect.get(row, key);
  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isNaN(millis) ? null : millis;
  }
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Fail at construction rather than silently stopping a filter at runtime. */
function assertMapped(filters: Filters, columns: ColumnMap): void {
  const unmapped = filters.specs
    // A `search` names its own columns; its key is a control name, not a column.
    .filter((spec) => spec.type !== "search")
    .map((spec) => spec.key)
    .filter((key) => !columns[key]);
  if (unmapped.length > 0) {
    throw new Error(
      `[createFeedHandler] filterable columns missing from the column map: ${unmapped.join(", ")}.` +
        ` Both the WHERE builder and the sort builder skip an unmapped key, so this would` +
        ` otherwise mean "that filter silently stops filtering".`,
    );
  }
}

/** A mapped column, or a construction-time error naming the missing key. */
function requireColumn(columns: ColumnMap, key: string, label: string): PgColumn {
  const column = columns[key];
  if (!column) throw new Error(`[createFeedHandler] ${label} "${key}" is not in the column map`);
  return column;
}

function resolveTiebreak(config: FeedConfig): PgColumn {
  const explicit = config.tiebreakKey ? config.columns[config.tiebreakKey] : undefined;
  const column =
    explicit ?? (config.tiebreakKey ? undefined : singleColumnPrimaryKey(config.table));
  if (!column) {
    throw new Error(
      `[createFeedHandler] no tiebreak column. The table has no single-column primary key, so` +
        ` pass a unique tiebreakKey: without one, rows sharing a cursor value come back in` +
        ` whatever order the plan produced and visibly reshuffle between refetches.`,
    );
  }
  return column;
}

/**
 * Build a feed handler.
 *
 * @example
 * ```ts
 * const feed = createFeedHandler({
 *   db, table: auditLog, filters, columns, cursorKey: "at",
 * });
 * const page = await feed.execute({ values: input.filters, scope: [orgScope] });
 * ```
 */
export function createFeedHandler(config: FeedConfig) {
  const { db, table, filters, columns, cursorKey, defaultSize = 50 } = config;
  const { sliderKeys, dateKeys, facetKeys } = passKeys(filters);

  assertMapped(filters, columns);

  const cursorColumn = requireColumn(columns, cursorKey, "cursorKey");
  const tiebreakColumn = resolveTiebreak(config);

  // The projection IS the column map, so rows come back keyed by filter key and
  // no caller maintains the inverse mapping.
  const projection: ExtraSelect = { ...columns, ...config.select };
  const valueFacetKeys = facetKeys.filter((key) => !sliderKeys.includes(key));

  /** The three passes. Every one carries the tenant scope. */
  function passes(request: FeedRequest) {
    const where = (selection?: FilterSelection): SQL[] => [
      ...request.scope,
      ...buildWhere(filters, request.values, columns, selection),
    ];
    // Slider bounds are computed over a set the sliders did not narrow, or
    // dragging one collapses its own range under the pointer.
    const withoutSliders = where({ exclude: sliderKeys });
    const sliderOnly = buildWhere(filters, request.values, columns, { only: sliderKeys });
    return { withoutSliders, all: [...withoutSliders, ...sliderOnly] };
  }

  /** Counts and facets — skipped entirely on a pagination request. */
  async function aggregates(request: FeedRequest, all: SQL[], withoutSliders: SQL[]) {
    if (request.includeFacets === false) {
      return { totalRowCount: null, filterRowCount: null, facets: {} satisfies Facets };
    }
    const [scoped, filtered, valueFacets, boundsFacets] = await Promise.all([
      db.select({ total: count() }).from(table).where(allOf(request.scope)),
      db.select({ total: count() }).from(table).where(allOf(all)),
      computeFacets({ db, table, columns, where: all, keys: valueFacetKeys }),
      sliderKeys.length === 0
        ? Promise.resolve({})
        : computeFacets({
            db,
            table,
            columns,
            where: withoutSliders,
            keys: sliderKeys,
            boundsKeys: sliderKeys,
          }),
    ]);
    return {
      totalRowCount: scoped[0]?.total ?? 0,
      filterRowCount: filtered[0]?.total ?? 0,
      facets: { ...valueFacets, ...boundsFacets },
    };
  }

  /** The user's sort, applied between the cursor and the tiebreak. */
  function sortClauseFor(sort: FeedSort | null | undefined): SQL | undefined {
    if (!sort) return undefined;
    const column = columns[sort.key];
    if (!column) return undefined;
    return sort.desc ? desc(column) : asc(column);
  }

  async function execute(request: FeedRequest) {
    const { sort = null, cursor = null, direction = "next", size = defaultSize } = request;
    const { withoutSliders, all } = passes(request);

    const plan = planCursor({
      cursor,
      direction,
      cursorColumn,
      tiebreakColumn,
      sort: sortClauseFor(sort),
    });
    const pageWhere = allOf(plan.condition ? [...all, plan.condition] : all);

    const [fetched, counted] = await Promise.all([
      db
        .select(projection)
        .from(table)
        .where(pageWhere)
        .orderBy(...plan.orderBy)
        .limit(overfetch(size)),
      aggregates(request, all, withoutSliders),
    ]);

    const snapped = snapPage(fetched, size, (row) => cursorMillis(row, cursorKey));
    let page = snapped.rows;

    // Degenerate case: one cursor value spans the whole page, so there is no
    // boundary to retreat to. Return the entire tied group — overflowing `size`
    // is the only way to make progress without dropping rows.
    if (page.length === 0 && snapped.tiedAt !== null) {
      page = await db
        .select(projection)
        .from(table)
        .where(and(...all, sql`${cursorColumn} = ${new Date(snapped.tiedAt)}`))
        .orderBy(...plan.orderBy);
    }

    if (plan.needsReverse) page.reverse();

    const first = page[0];
    const last = page[page.length - 1];
    // A short page is the end of the feed. Handing back a cursor anyway costs
    // the client one round trip to discover the same thing.
    const exhausted = fetched.length <= size;

    const meta: FeedMeta = {
      nextCursor: exhausted || last === undefined ? null : cursorMillis(last, cursorKey),
      prevCursor: first === undefined ? null : cursorMillis(first, cursorKey),
      totalRowCount: counted.totalRowCount,
      filterRowCount: counted.filterRowCount,
      facets: counted.facets,
      where: all,
      whereWithoutSliders: withoutSliders,
    };

    return { rows: page, ...meta };
  }

  return { execute, dateKeys, sliderKeys, facetKeys, cursorColumn, tiebreakColumn };
}
