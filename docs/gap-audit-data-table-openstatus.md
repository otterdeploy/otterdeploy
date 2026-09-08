# Data Table: deep review of openstatus `data-table-filters`, and the otterdeploy gap

Date: 2026-09-08 · Reference: `github.com/openstatusHQ/data-table-filters` @ `cf49057`
(`feat: data-table-filter-rail #103`) · Live: <https://data-table.openstatus.dev/infinite>

Method: the reference repo was cloned and read in full — `packages/registry/src` (36.8k LOC,
the installable core) and `apps/web/src` (32.6k LOC, the demo + docs), plus its own
`content/docs/*.mdx` design notes, then every claim in those docs verified against the code.
Our side: every file under `apps/web/src` that renders a table, the `@otterdeploy/data-engine`
filter/SQL model, `@otterdeploy/shared` filter vocabularies, and the oRPC list contracts.

Tags used below: **[MISSING]** not present here · **[DIVERGENT]** present but different ·
**[AHEAD]** we are better · **[RISK]** adopting it as-is would break a repo rule.

---

## 0. The one idea worth stealing

Everything good in that codebase falls out of a single decision:

> **A column's filter behaviour is *declared once as data*, compiled into a closed set of six
> canonical operations, and every engine — Postgres SQL, in-memory JS, TanStack Table's client
> `filterFn`, the AI/MCP coercion boundary — consumes those six ops. No engine ever inspects the
> runtime shape of a filter value.**

That is `packages/registry/src/lib/filters/` (701 LOC, 4 files). Everything else — the sidebar,
the command palette, the faceted counts, the drizzle handler, the row actions' availability
guards — is a consumer of that one declaration. It is the reason a numeric checkbox filter
*cannot* silently compile to `BETWEEN 200 AND 500` in SQL while behaving as `IN (200,500)` on the
client: `numberRange` is unreachable from `{ type: "checkbox", kind: "number" }`.

We have three-and-a-half partial versions of this idea already (§3.3). We do not have the one
that unifies them.

---

## 1. Reference architecture, layer by layer

```
col.* builder  ──►  TableSchemaDefinition (plain data + a renderers sidecar)
                        │
      ┌─────────────────┼───────────────────┬──────────────────┐
      ▼                 ▼                   ▼                  ▼
 generateColumns   generateFilterFields  defineFilters    generateSheetFields
 (ColumnDef[])     (sidebar/cmdk config) (FilterSpec[])   (row-detail fields)
                                             │
                        ┌────────────────────┼────────────────────┐
                        ▼                    ▼                    ▼
                 buildWhereConditions   filters.apply()     filters.filterFn()
                    (Drizzle SQL)        (in-memory)        (TanStack column)
```

State is orthogonal to all of it: a `StoreAdapter` (nuqs / zustand / memory / yours) feeds the
same values into whichever engine is running.

### 1.1 Declaration layer — `lib/table-schema/col.ts` (574 LOC) + `generators/`

**Immutable fluent builder.** Every method returns a *new* builder
(`col.ts:createColBuilder → next()`). Reason: schemas are module-level constants shared by
generators that run at import time; a mutating chain would let one generator observe a
half-built column.

**The descriptor / renderers split.** A column is `{ descriptor, renderers }` where the
descriptor is pure JSON and the renderers hold JSX closures.
`display("custom", { cell })` deliberately does *not* become a descriptor state — the closure
goes to the renderers half and the descriptor keeps its serializable display, so `toJSON()`
still round-trips and the row-detail sheet still has a real fallback renderer. This is what
lets a `"use client"` table schema cross to the server as data (`defineFilters(schemaJson)`).

**`compact()` drops `undefined` keys** (`col.ts:52`) because `JSON.stringify` erases them, so a
descriptor carrying one compares unequal to its own round-trip while looking identical through
JSON. The case that actually occurs: `col.presets.duration()` with no unit.

**Type-level filter constraint.** `ColBuilder<T, F>` narrows `F` per factory, so
`col.string().filterable("slider")` is a *compile* error, and `FilterValues<TSchema>` derives
the accepted value shape per column — which is then what an action's `when` guard is typed
against. A key typo in an availability guard is a type error, not a guard that matches every row.

**Sizing has exactly one interpretation** (`generators/columns.tsx:sizingFor`):
`.minSize()` = flexing with a floor · `.size()` alone = locked (min/max pinned) · `.size()` +
`.resizable()` = initial width only. Encoded once so the header and cell CSS can't disagree.

**Dotted keys are the identity space.** `"timing.dns"` is the schema key, the URL param, the
facet key and the `columnMapping` key; only the DB column is `timing_dns`. Columns with dots get
`id + accessorFn`, others `accessorKey`. CSS variables replace `.` with `-` because a dot is
illegal in a custom property name (`data-table-infinite.tsx:columnSizeVars`).

### 1.2 Semantics layer — `lib/filters/` (the keystone)

`FilterSpec = { key, type: "input"|"checkbox"|"slider"|"timerange", kind: ColKind, itemKind?,
options?, min?, max? }` — flattened to plain data so no backend can reach for anything else.

`FilterOp` is a **closed six-member union**: `substring · equals · oneOf · overlaps ·
numberRange · dateRange`. Every engine switches exhaustively with **no default branch**, so
adding a seventh op is a compile error in every engine rather than a silent fall-through. The
docstring states this is the design, not a defect.

`normalize(spec, value)` dispatches on the **declared** `(type, kind)` pair, never on the value's
runtime shape. The specific bugs this kills, each named in the source:

| Case | Naive behaviour | Declared behaviour |
|---|---|---|
| `input` on a number column | substring → `"5"` matches `1500` | `equals` |
| `checkbox` on `[200,500]` | length-2 array → `BETWEEN` | `oneOf` |
| `checkbox` on an array column | membership | `overlaps` (set ∩ set) |
| slider with one handle | `equals` | degenerate `numberRange` (differs on non-integers) |
| timerange with one date | point-in-time | whole day, `startOfDay`→`endOfDay` |
| timerange reversed | empty result | bounds swapped |
| `["", 500]` on a slider | filter vanishes | `isActive` = *any* usable member |

`asDate` disambiguates `"1700000000000"` (epoch millis as a string — what the command palette
serializes and what JSON/MCP/LLM output carries) from `"2024"` by magnitude test against
`1_000_000_000_000`; `new Date("1700000000000")` is otherwise an Invalid Date.

`asDeclaredScalar(kind, value)` coerces checkbox members to the *column's* declared type, so a
numeric column filtered from a URL (`["200","500"]`) doesn't reach `inArray(integerColumn,
["200","500"])` and depend on Postgres casting the literals.

`coerce(raw)` is the untrusted-input door (AI structured output, MCP args): it round-trips
through `normalize` (if the declared semantics can't make an op, it isn't a filter value), drops
enum members outside the declared option set, and **clamps numeric ranges to declared bounds**
because an LLM asked for "slow requests" happily produces `[0, 99999]` against a `0–5000` slider.

`filterFn(key)` returns a *function*, not a registered name — so consuming tables don't have to
remember `filterFns: { inDateRange, arrSome }`, "a contract that was undocumented outside a
comment and silently broke filtering when missed".

`evaluateOp` mirrors SQL exactly: `substring` is case-insensitive to match `ilike`; `overlaps`
treats a scalar cell as a one-element set (the infinite route used to look only at
`row[key][0]`); `sameScalar` compares by string as a last resort rather than coercing, so
`0 == false` never becomes true.

### 1.3 State layer — "BYOS", `lib/store/`

An adapter interface (`subscribe / getSnapshot / getServerSnapshot / setState / setField /
reset / pause / resume / destroy / getTableId / getSchema / getDefaults`) read through
`useSyncExternalStore` with an optional selector, so a component subscribes to *one field*.

Control-flow decisions worth naming:

- **Selector granularity is a render-count decision.** `Row` selects
  `isMultiSelect && s.uuid === row.id` — a *boolean*, so `useSyncExternalStore` bails out for
  every row whose detail state didn't flip. Folding `isMultiSelect` inside the selector stops
  single-select mode (which still writes the selected id to `uuid`) waking any row at all.
- **The adapter identity is load-bearing.** nuqs rebuilds its setter every render, so the setter
  is read through a ref and kept *out* of the adapter's `useMemo` deps. Otherwise the adapter
  changes identity every render → the provider's context value, `useFilterActions.setFilters`,
  and therefore the `onRowClick` handed to every memoized row all change → **every row in the
  table re-renders on every render of the table**.
- **`pause()` / `resume()` queue writes** (`pendingStateRef`) so live-mode polling doesn't spam
  URL history.
- **`validateState` = serialize-then-reparse.** A URL param that can't survive its own field
  codec falls back to the default rather than entering state.
- **Two-way table↔store sync is deliberately asymmetric** (`data-table-store-sync.tsx`):
  on *initial mount only*, store→table (URL params exist before `useState(defaultColumnFilters)`
  sees them under SSR/hydration); after mount, table→store. `lastSentFiltersRef` nulls only keys
  this sync previously wrote, so a filter set externally is never clobbered. Sorting and
  selection each get their own guarded effect with a last-sent ref.

### 1.4 Transport layer — `lib/data-table/create-query-options.ts`

- **Query key excludes `cursor`, `direction`, `uuid`, `live`** so opening a row detail, toggling
  live mode or paging never invalidates the cache. The key is the *serialized search string*, so
  it is stable and human-inspectable.
- **`skipMetaOnPagination`** appends `_meta=false` to page-2+ requests (facets/chart/aggregates
  are identical for a fixed filter set). Opt-in because it is only correct if the route honours it
  *and* the client reads meta via `getMetaPage`. `_meta` is appended **after** the serializer runs
  because it is a transport control param, not part of any consumer's search schema — an
  allow-list serializer would otherwise drop it, and it never enters the query key.
- **`getMetaPage(data)`** finds the page whose *pageParam* carried `_meta: true`, not index 0:
  live mode prepends pages via `fetchPreviousPage`. Inferring it from the payload ("the page with
  non-empty chartData") misfires when a filter legitimately matches nothing.
- `keepPreviousData` + `staleTime: 5min` + no refetch-on-focus: filter changes swap content
  without a spinner flash.

### 1.5 Server layer — `lib/drizzle/` (1.3k LOC)

**Three-pass filtering.** Pass 1 = date only; pass 2 = date + non-slider (slider min/max facets
are computed over *this*, so dragging a slider can't collapse its own bounds); pass 3 = all
filters (rows, counts, non-slider facets). The in-memory demo route runs the identical three
passes through `filters.apply(..., { only/exclude })` — same selection API, different engine.

**The projection *is* the column mapping.** `db.select({...columnMapping, ...extraSelect})` means
rows come back keyed by schema keys (`"timing.dns"`), so nobody writes the inverse map. Two
hand-written copies of that inverse had already drifted.

**Fail loudly at construction.** Every filterable spec key missing from `columnMapping` throws at
handler build time *with the paste-ready snippet*, because both `buildWhereConditions` and
`buildOrderBy` skip unmapped keys — a typo used to mean "this filter silently stops filtering".

**Cursor pagination, and the two things everyone gets wrong:**
1. *Tiebreak.* Order is `cursor, user sort, unique tiebreak` — defaulting to the table's
   single-column primary key, discovered via `getTableConfig`. Without it rows sharing a
   timestamp shuffle between refetches.
2. *Boundary snapping.* Fetch `size + 1`; if the extra row shares the last page row's cursor
   value, **retreat the page** until the boundary falls between distinct cursor values — because
   the next page uses a strict `<`, so any tied row left behind would never be returned by any
   page. Degenerate case (one cursor value spans a whole page): re-query the entire tied group
   and overflow `size`, the only way to make progress without dropping rows.
   The cursor is read by **schema key**, not SQL column name — reading `row[cursorCol.name]`
   returned `undefined` for any renamed column, so `nextCursor` was null and pagination silently
   ended after one page.

**`overlaps` casts to the column's own array type** read off the Drizzle schema
(`column.getSQLType()`), because Postgres `&&` resolves *no* implicit casts: a hardcoded
`::text[]` made `col.array(col.number())` fail with "operator does not exist", and deriving the
cast from the declared item kind can't work either (`integer[]` vs `bigint[]` vs `double
precision[]`).

**`result.scope`** hands back `{ db, table, columns, where, whereWithoutSliders, range, bucketMs }`
so a chart or rollup query doesn't re-derive the filtered set, the time range (explicit filter
first, else `MIN/MAX` over the set, and the discovery query is *skipped* when a range was given)
or the bucket size (a 13-rung interval ladder, `interval.ts`).

**Facets** run in parallel: `MIN/MAX + COUNT` for sliders, `unnest + GROUP BY` for array columns,
plain `GROUP BY` otherwise. `sql-injection.test.ts` pins the deliberate decision *not* to escape
LIKE metacharacters (safe-but-broadening).

### 1.6 Render layer — `data-table-infinite.tsx` (747 LOC, TanStack Table **v9**)

- **`tableOptions` must be memoized by the caller** in v9 (`useTable` ends in a `useMemo` over
  `[table, options, state]`), or every `useDataTable()` consumer re-renders on every
  ResizeObserver tick, `isFetching` flip and live poll.
- **`manualPagination: true` is not optional**: the shared feature set registers
  `paginatedRowModel`, and v9 routes `getRowModel()` through it whenever that slot exists and the
  flag is falsy — silently truncating every fetch to `pageSize` 10.
- **The row memo comparator cannot be replaced by the React Compiler.**
  `createCoreRowModel` memoizes on `[options.data]`, so every `fetchNextPage` hands back *new*
  `Row` objects for already-rendered rows. The comparator uses `row.id` **and `row.original`** —
  id alone holds stale cells on screen after a row action edits a row in place.
- **`<Subscribe>` inside the row** re-subscribes the cell subtree to `columnVisibility`,
  `columnOrder` and *this row's own* selection flag — not the whole `rowSelection` map, so a
  checkbox click re-renders only the rows that flipped. Without it the compiler caches the cell
  subtree on `row` identity and no prop change can reach it.
- **`getRowClassName` is a prop, not read off `table.options.meta`** — behind a method chain the
  compiler can't see it, so the class was computed once per row object and never again; live mode
  used to force it by subscribing every row to `live`, which re-rendered everything and fixed
  nothing.
- **`onRowClick` deliberately does not read the detail row id.** Each row reads its own detail
  state and passes it back, keeping the callback stable across selections.
- **Column sizing via CSS variables** computed once at table level
  (`--header-x-size` / `--col-x-size`), because `column.getSize()` per cell per render is the
  documented TanStack perf trap.
- **`canLoadMore`**: `hasNextPage` alone is wrong for this API shape (it stays true until a page
  comes back empty), so the server's `filterRows` is authoritative — and the prop's docstring
  warns that under-reporting it makes rows unreachable, so "leave it undefined rather than pass a
  guess".
- **No virtualization.** Rows are all rendered; the memo comparator is the only thing between it
  and quadratic scroll cost. This is a real ceiling (see §4 [AHEAD]).

### 1.7 Interaction surface

- **Filter sidebar**: accordion, one component per filter type from a `FILTER_COMPONENTS`
  registry (extend by adding an entry). Checkbox rows show facet counts and a hover-only "only"
  button; a search box appears past 4 options; skeletons while options are unknown. Input and
  slider debounce at 500ms and re-sync from the store when the store wins.
- **Command palette** (`⌘K`, cmdk): grammar `key:value`, `key:a,b` (union), `key:1-500` (range),
  `key:"with spaces"`. **Split on the first colon only** — URLs and timestamps contain colons.
  A custom `filter()` scores items by the word under the caret; parse/serialize round-trips
  through the *field codecs* (so the palette and the URL always agree); search history in
  localStorage; `commandDisabled` fields are hidden from the palette but still available to the AI.
- **Row detail sheet**: `↑/↓` navigation across rows (ignored while a menu has focus), focus
  restored to the originating row on close, single-select via `rowSelection` and multi-select via
  a `uuid` field in filter state.
- **Live mode**: `fetchPreviousPage` every 5s; the activation timestamp is *state adjusted during
  render* (prev-value compare), not a ref or effect, because it is read during render to dim older
  rows and switching live off triggers no refetch of its own. Live resets when a date filter or
  sort is set (they contradict tailing).
- **Timeline chart**: drag to select, and the selection is **parked, not applied** — a card grows
  Cancel/Zoom buttons (`Esc`/`Enter`), so a drag can't accidentally re-query.
- **Column view options**: visibility + drag-to-reorder in one popover, `getCanHide()` as the
  single source of truth; order and visibility persisted per `tableId` in localStorage
  (hydrated *after* mount, with a dirty-key ref so an early write isn't clobbered).
- **Hotkeys**: `⌘K` palette · `⌘B` sidebar · `⌘U` reset columns · `⌘J` live · `⌘.` reset focus ·
  `⌘⇧X` deselect · `Esc` reset filters.
- **Row actions** (`data-table-actions`): the *server* declares what can be done
  (`ActionDescriptor[]` on the response meta), availability is declared as filter values
  (`when: { status: ["dead"] }`) so the **same declaration** becomes the per-row `_actions` stamp
  (in-memory `filters.matches`) and the handler's SQL `WHERE` guard. Descriptors go over the wire
  through an explicit pick-list so a `when` clause or handler can't leak. Confirmations carry
  `{count}` pluralization and a `count_mismatch` re-confirm path.

### 1.8 Correctness discipline

`lib/filters/testing/conformance.ts` (1,064 LOC) is a shared suite run against **every** engine —
SQL, in-memory, TanStack — so "the client and the server agree" is a test, not a hope. Plus
`sql-injection.test.ts`, `tie-order.test.ts`, `payload-parity.test.ts`, `descriptor-laws.test.ts`
(round-trip laws for serialize/deserialize), and row-level render tests for the memo comparator.
≈47% of the registry’s LOC is tests (17.5k of 36.8k).

### 1.9 Distribution

Shipped as a **shadcn registry** (`packages/registry/public/r/*.json`, 12 blocks) plus an agent
`SKILL.md`, an MCP server, and an AI filter endpoint. "It's not a library, it's a playbook" —
you copy files in and own them. E2E tests actually install the blocks into scratch Next apps.

---

## 2. What we have today

### 2.1 Inventory

`@tanstack/react-table` **v8.21.3** appears in exactly three places:
`features/logs/*` (the live-tail table), the postgres data-studio "dice grid", and
`shared/components/data-grid/*` (an 11k-LOC editable spreadsheet grid — a different product).

**34 files** render `shared/components/ui/table.tsx` directly as hand-written markup:
audit, deployments, volumes, certificates (×3), firewall (×4), edge logs (×3), analytics (×3),
docker (×4), webhooks deliveries, api-keys, networking routes, templates, backups (CSS grid),
buckets objects (own table + own column-resize hook), redis studio.

`shared/components/ui/table.tsx` is 89 lines of unstyled `<table>` primitives. There is no shared
data-table above it. `shared/components/table-selection.tsx` (322 LOC) is the only shared
cross-table behaviour.

### 2.2 Per-layer, today

| Layer | Reference | otterdeploy today |
|---|---|---|
| Column declaration | one `col.*` schema → columns/filters/sheet/URL codec | per-table JSX, per-feature header-class conventions (`firewall-table.tsx` documents its own "shared vocabulary" because three firewall tables had drifted) |
| Filter semantics | `defineFilters` → 6 ops → 3 engines | 4 partial models, none shared (§3.3) |
| Filter state | pluggable adapter, URL by default | **3 different homes**: URL+zod (`logs`, `deployments`, data studio), TanStack Form (`audit-filters.tsx:51`), plain `useState` (`edge-logs-view.tsx:46-54`, firewall, buckets) |
| Fetch | infinite cursor + stable key + meta skipping | mostly `useQuery` with the whole filter set in the key; two hand-rolled infinite queries (`notifications/delivery-history-dialog.tsx:51`, `storage/data/buckets.ts:60`); TanStack DB collections with serialized subset keys (`features/audit/data/audit.ts`) |
| Pagination | cursor + tiebreak + boundary snapping | `limit`/`offset` (`routers/audit/index.ts:96`), "load more" by bumping `limit`, page/pageSize in the URL (deployments, data studio) |
| Facets | server counts + slider bounds, three-pass | none. `audit.distinct` returns values **without counts**; firewall computes `stateCounts` client-side over the loaded page |
| Sorting | URL-encoded `id.asc`, server ORDER BY | mostly none; logs sorts client-side; buckets sorts the loaded page only ("stays out of the URL") |
| Column visibility / order | per-table localStorage + reorder UI | only the data studio (`data/column-prefs.ts`), visibility only, no ordering |
| Row detail | shared sheet with ↑/↓ + focus return | per-feature panels (logs, edge logs, audit drawer, studio row detail) |
| Command palette over filters | full grammar + facet autocomplete | app-level command palette exists (`features/command-palette/`) but drives navigation, not table filters |
| Row actions | server-declared descriptors + SQL guard | per-table dropdowns wired by hand |
| Live mode | `fetchPreviousPage` poll + dimming | logs has a real live tail (WS stream); edge logs polls at 2s; no shared idiom |

### 2.3 The four partial filter models we already own

1. **`@otterdeploy/data-engine`** (`filters.ts`, `query.ts`) — 15 ops with arity/group metadata,
   `ColumnLookup` allowlist, `validateQueryInput` returning a `Result`, and a parameterized
   dialect-aware SQL compiler. **This is the closest thing we have to `defineFilters`** — but it
   is scoped to *user-owned* databases (introspected columns), not our own app tables, and it has
   no in-memory evaluator and no facets.
2. **`@otterdeploy/shared/storage-filter`** — a token grammar (`class:GLACIER_IR size:>100MB
   modified:<30d`) explicitly documented as "shared by both sides of the wire… one grammar means
   the stats strip and the table can never disagree". Compiles to *predicates* only.
3. **`@otterdeploy/shared/analytics-filters`** + `features/analytics/lib/filter-codec.ts` — a
   shared dimension/op vocabulary consumed by the oRPC contract, the SQL compiler and a URL codec
   (`f=dim:op:value;…`, URI-encoded so `:`/`;` in a path can't split a segment).
4. **`features/resources/.../data/filter-draft.ts`** — the UI-identity/wire-model split for a
   filter row being edited (id lives on the draft, stripped on apply).

We independently arrived at the reference's *thesis* three times. We never generalized it, so
none of the three helps the audit table, the deployments table or the edge log table.

---

## 3. Gap analysis

### 3.1 Architecture

- **[MISSING] One filter-semantics module for app-owned tables.** No canonical op set; each oRPC
  list contract hand-declares its own filter fields (`routers/audit/contract.ts:39-52`), each
  handler hand-builds its `SQL[]`, and the client re-implements any client-side narrowing
  separately. Nothing prevents client and server disagreeing about what a filter means.
- **[MISSING] Declarative column/table schema.** Columns, filter controls, detail-panel fields and
  the URL codec are written 3–4 times per surface, by hand, in different styles.
- **[MISSING] Faceted counts anywhere in the product.** Users cannot see "error: 128, warn: 12"
  before clicking a filter. `audit.distinct` deliberately queries the *window only, not the other
  filters* so options don't vanish — the right instinct, and exactly what the reference's
  three-pass strategy formalizes with counts attached.
- **[MISSING] Cursor pagination with a tiebreak.** Offset pagination over a `desc(timestamp)`
  feed drops/duplicates rows under concurrent inserts, which is precisely what an audit log and a
  deployment feed do all day. No table in the app has a tiebreak column in its ORDER BY.
- **[MISSING] Server-authoritative filtered row count as a first-class contract field.** Audit
  returns `total`; most list endpoints return only rows, so "load more" honesty varies.
- **[DIVERGENT] Filter state has three homes.** Two of the three (Form, `useState`) mean a
  filtered edge-log or audit view **cannot be linked or reloaded** — a direct violation of the
  reason our own `deployments-search.ts` docstring gives for using the URL ("shareable and
  survives reload"). The reference solves it once with an adapter interface.
- **[DIVERGENT] No shared row-detail idiom**, so `↑/↓` row navigation and focus restoration exist
  nowhere, and each panel re-derives selection.
- **[DIVERGENT] Column preferences.** Only the data studio persists visibility; no table persists
  order; nothing is namespaced by a `tableId` convention.

### 3.2 Where we are ahead — do not regress these

- **[AHEAD] Virtualization.** `use-logs-table.ts` virtualizes with row-id keys, a fixed 25px row,
  a deliberate no-`measureElement` decision and a documented state-not-ref scroll-element attach.
  The reference renders every row and has no answer past a few thousand.
- **[AHEAD] Honest states.** Every one of our tables has designed loading / error+retry / empty
  states (`audit-table.tsx`, `deployments-table.tsx`); the reference has `"No results."` in a
  `colSpan` cell.
- **[AHEAD] Responsive.** We stack rows into cards below `md` (audit, firewall, backups) with a
  documented rationale. The reference hides the sidebar and lets a 9-column table scroll sideways.
- **[AHEAD] i18n.** Our columns take `t` as a parameter precisely because TanStack calls
  `header`/`cell` as plain functions (`log-columns.tsx`). The reference has no i18n at all.
- **[AHEAD] Repo discipline.** Temporal instead of `Date`, `better-result` instead of try/catch,
  zero type assertions, oRPC typed contracts end to end. The reference has none of these.
- **[AHEAD] Multi-tenancy.** Every list is org-scoped through `orgScopedProcedure` with documented
  reasoning about NULL-org denial rows. The reference has no tenancy concept — a ported handler
  **must** compose a mandatory scope predicate that no filter input can weaken.

### 3.3 Adoption risks

- **[RISK] The reference is TanStack Table v9; we are on v8.21.3.** `useTable`, `tableFeatures()`,
  `<Subscribe>`, `table.store`, `table.state`, per-column `TValue`, function-valued `filterFn`
  registration — none exist in v8. Roughly 40% of the render-layer rationale (§1.6) is
  v9-specific. Either the port targets v8 idioms (`useReactTable`, `getState()`, registered
  `filterFns`, our own memo comparator) or we take a v9 migration as a separate, scoped project.
  **Recommendation: build against v8 now**; the semantics/server/state layers are version-free,
  and they are 80% of the value.
- **[RISK] Copy-paste from the registry will not pass lint.** The reference uses `as` casts
  everywhere (banned at error level, `.oxlintrc.json:92`), raw `try/catch`, and `Date`
  arithmetic (`normalize.ts` `startOfDay/endOfDay`, `evaluate.ts` `getTime()`), plus deps we do
  not have (`nuqs`, `superjson`, `date-fns`, Radix). Every ported file is a **rewrite**, not a
  copy: `Temporal.Instant`/`ZonedDateTime` via `@otterdeploy/shared/temporal`, `Result.try` at
  parse boundaries, `satisfies`/type guards instead of assertions.
- **[RISK] nuqs has no place here.** We use TanStack Router `validateSearch`. The BYOS adapter
  interface is exactly the seam for this — write a **router adapter** whose `setState` calls
  `navigate({ search })` with `replace` for throttled writes.
- **[RISK] `_meta=false` has no analogue over oRPC.** The transport param trick depends on a REST
  URL. With oRPC it becomes an explicit input field on the contract (e.g. `includeMeta: boolean`)
  which *does* enter the query key — so the split must instead be **two procedures** (`list` for
  rows, `listMeta` for facets/counts/chart) keyed separately. That is arguably cleaner and it is
  the shape our audit page already stumbled into ("rows → collection, counts → companion query",
  `features/audit/data/audit.ts` header comment).
- **[RISK] TanStack DB collections vs. cursor infinite queries.** Our audit page documents why the
  aggregate envelope is an awkward fit for a collection. A shared data table should standardise
  on **React Query infinite + oRPC** for server-paginated feeds and leave collections for
  entity-shaped, fully-loaded sets (projects, buckets, api-keys). Mixing them per surface is how
  we got here.
- **[RISK] The `overlaps` array cast trick** relies on `column.getSQLType()`; our drizzle version
  and array-column usage need checking before the op is offered.

---

## 4. Goals

**North star.** One declared table schema per list surface; filter meaning defined once and
compiled by both engines; filter state in the URL by default; server-side filtering, sorting,
faceting and cursor pagination behind one oRPC shape; one rendering shell with our honest states,
responsive stacking, virtualization and i18n intact.

Framed against PRODUCT.md: **honest-about-system-state** (real counts, real facets, no guessed
`filterRows`), **calm-density** (one table vocabulary instead of 20), **fast-is-a-feature**
(cursor paging, stable query keys, memoized rows), **one-coherent-vocabulary** (⌘K grammar and
sidebar say the same thing as the URL and the SQL).

### G1 — `@otterdeploy/table-filters`: one filter semantics module
A new package (or `packages/shared/src/table-filters/`) providing `defineFilters(specs)` with our
own closed op set, `plan/matches/apply/filterFn/coerce`, and a Drizzle compiler
`buildWhere(filters, values, mapping, selection)`.
Non-negotiables: Temporal not `Date`; no assertions; `Result` at every parse boundary; exhaustive
switches with no default branch; a **conformance test suite run against both engines**.
Reuse rather than reinvent: lift the op vocabulary from `@otterdeploy/data-engine` where it fits
so the studio and the app tables share one mental model.
*Done when*: `audit.list` filtering is expressed as specs and a golden test proves the SQL and the
in-memory evaluator agree on a fixture set for every op × kind pair.

### G2 — List contract shape
An oRPC convention for server-paginated feeds: input `{ filters, sort, cursor, direction, size }`,
output `{ items, nextCursor, prevCursor, totalRowCount, filterRowCount }`, plus a sibling
`*.facets` procedure returning `{ rows: [{value,total}], min?, max? }` per key, computed with the
three-pass strategy. Cursor + **mandatory unique tiebreak**, boundary snapping, and an org-scope
predicate composed outside the filter path so no input can weaken it.
*Done when*: `audit.list` and `deployment.listByProject` are migrated and a test proves no row is
skipped or duplicated across pages with concurrent inserts at a shared timestamp.

### G3 — Filter state adapter for TanStack Router
`useRouterFilterAdapter(schema, { id })` implementing the BYOS interface over `validateSearch` +
`navigate`, with throttled `replace` writes, pause/resume, defaults-omitted encoding (our
`deployments-search.ts` and `data/url-state.ts` already do defaults-omission; formalize it).
*Done when*: edge logs and audit filters move from `useState`/Form to the URL with no behaviour
change, and a filtered view is linkable.

### G4 — `<DataTable>` shell (v8)
One component: sticky header, CSS-variable column sizing, memoized rows keyed on
`id + original`, our loading/error/empty states, responsive stacked-card fallback,
**virtualization on by default**, `canLoadMore` semantics from the server's `filterRows`,
selection + floating bulk bar, and a `tableId`-namespaced localStorage for column visibility and
order.
*Done when*: audit, deployments and edge logs render through it and the three feature-specific
header-class conventions are deleted.

### G5 — Filter sidebar + facet counts
Accordion sidebar with a component registry per filter type, checkbox counts and "only", slider
bounds from server facets, debounced input, timerange with presets. Facets injected into filter
fields at runtime exactly as the reference does.
*Done when*: the audit page shows counts per action/actor/outcome and the `distinct` endpoint is
replaced by facets.

### G6 — ⌘K filter grammar
`key:value`, `key:a,b`, `key:1-500`, `key:"a b"`, first-colon split, parse/serialize through the
same field codecs as the URL, facet-backed autocomplete, history in localStorage. Reuse our
`storage-filter` tokenizer instincts; it must round-trip against the URL codec by test.
*Done when*: a query typed in the palette and the same filter built in the sidebar produce
byte-identical URLs.

### G7 — Row detail sheet + row actions
Shared sheet with ↑/↓ navigation, focus restoration, field-list rendering from the schema; row
actions declared server-side with availability expressed as filter values so the guard is the
same declaration in JS and SQL.
*Done when*: audit's drawer and logs' detail panel are the same component with different fields.

### Sequencing

```
G1 ──► G2 ──► G5
 │      │
 └► G3 ─┴► G4 ──► G6
                └► G7
```
G1 is the keystone and is pure, testable, UI-free — start there. G4 without G1 just moves markup
around; G5/G6 without G2 have nothing truthful to display.

**First slice (one PR, end to end): the audit page.** It has real filters, a real time window, a
real aggregate envelope, a drawer, and it is already documented as an awkward fit for our current
architecture — so it exercises every layer and its pain is already understood.

### Explicitly out of scope for now
AI filter inference, the MCP server, the shadcn-registry packaging, the schema *builder* UI, and
the v9 migration. Each is a separate decision; none blocks G1–G7.

---

## 5. Decision index (quick reference)

| # | Decision | Reason it is that way |
|---|---|---|
| 1 | Six canonical ops, closed union, no default branch | a 7th op must fail to compile in every engine, not silently match nothing |
| 2 | Dispatch on declared `(type, kind)`, never value shape | length-2 arrays and stringified numbers are ambiguous; declaration is not |
| 3 | `input` on a number column = `equals` | substring on a stringified number makes `5` match `1500` |
| 4 | checkbox on an array column = `overlaps` | the column is a set on both sides |
| 5 | one-handle slider = degenerate range | equality and range differ once values are non-integer |
| 6 | one date = whole day; reversed bounds swapped | matches how a date picker is read |
| 7 | `isActive` = *any* usable array member | one blank entry must not delete the whole filter |
| 8 | `coerce` clamps ranges + drops unknown enum members | LLM/MCP input invents values and unbounded ranges |
| 9 | `filterFn` returns a function | name registration is an invisible contract that breaks silently |
| 10 | Three-pass filtering | a slider must not collapse its own facet bounds |
| 11 | Projection = column mapping | the hand-written inverse map had already drifted twice |
| 12 | Throw at handler construction on unmapped keys | an unmapped key otherwise stops filtering with no error |
| 13 | Cursor + unique tiebreak | tied timestamps otherwise reshuffle between refetches |
| 14 | Fetch `size+1`, retreat off a tied boundary | strict `<` would orphan tied rows forever |
| 15 | Read the cursor by schema key | reading the SQL column name broke renamed columns silently |
| 16 | `&&` cast from `column.getSQLType()` | Postgres resolves no implicit array casts |
| 17 | Query key excludes cursor/uuid/live/direction | opening a row or tailing must not invalidate the cache |
| 18 | `_meta=false` appended after serialization | it is transport, not part of any consumer's schema |
| 19 | `getMetaPage` reads pageParams, not index 0 | live mode prepends pages |
| 20 | `canLoadMore` prefers server `filterRows` | `hasNextPage` stays true until a wasted empty fetch |
| 21 | Adapter identity stabilized via ref | an unstable adapter re-renders every row every render |
| 22 | Row selector returns a boolean | `useSyncExternalStore` then bails out per row |
| 23 | Memo comparator on `id` **and** `original` | id alone shows stale cells after an in-place row edit |
| 24 | `<Subscribe>` per row for cell-affecting slices | the compiler otherwise freezes the cell subtree |
| 25 | `getRowClassName` as a prop | behind `options.meta` the compiler can't see the dependency |
| 26 | Live timestamp = state adjusted during render | a ref/effect paints one stale frame; toggling off triggers no refetch |
| 27 | Chart selection parked until confirmed | a drag must not silently re-query |
| 28 | Store→table sync only on initial mount | URL params land after `useState` under hydration |
| 29 | Null only previously-sent keys on sync | never clobber externally-set filters |
| 30 | Split on the first colon | values contain colons (URLs, timestamps) |
| 31 | localStorage read after mount, dirty-key guarded | server HTML has no localStorage; early writes must survive |
| 32 | `manualPagination: true` mandatory (v9) | a registered paginated row model silently truncates to 10 |
| 33 | Action availability declared as filter values | one declaration becomes both the per-row stamp and the SQL guard |
| 34 | Descriptors published through an explicit pick-list | prevents leaking handlers/guards over the wire |

---

## 6. Status

This document is research and planning only — **no implementation has started**. Nothing in
`apps/` or `packages/` is changed by this commit. The recommended next action is G1
(`@otterdeploy/table-filters` + conformance suite), which is self-contained, needs no UI, and
unblocks every other goal.

`bd` (beads) is not installed in this environment, so the goals above are not yet filed as
issues; G1–G7 map 1:1 onto issues when it is available.
