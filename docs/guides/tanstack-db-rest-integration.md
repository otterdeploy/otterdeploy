# TanStack DB over a traditional REST API — the complete field guide

A grounded reference for wiring TanStack DB (`@tanstack/react-db` + `@tanstack/query-db-collection`, v0.5)
to ordinary REST endpoints — list + detail, joins, nested/"included" data, search, pagination,
mutations — and **every place it goes wrong, with the fix**.

Examples use the [DummyJSON](https://dummyjson.com) products API because it has the same envelope,
nested objects, and detail/list split you meet in real REST APIs.

Every claim about TanStack DB behaviour below is cited to the actual source file it came from
(`packages/db/src/query/expression-helpers.ts`, `packages/query-db-collection/src/query.ts`,
`packages/query-db-collection/src/serialization.ts`) — not the marketing blog.

---

## 0. The one mental model that prevents 80% of the pain

> **A collection is a normalized store for ONE resource type, keyed by `getKey`.
> Endpoints fill collections. Views are live queries over collections. You never build a collection per screen.**

```
REST world                         TanStack DB world
──────────                         ─────────────────
GET /products            ─fills→   productsCollection   (keyed by id)
GET /products/:id        ─fills→   productsCollection   (same store, richer row)
GET /products/categories ─fills→   categoriesCollection (keyed by slug)
the "product detail page"  is  →   a live query: where(id) + joins/includes
the "dashboard"            is  →   a live query joining several collections
```

If you ever find yourself writing a `useEffect` to copy data between collections, **stop** —
you've left the model and you're back to hand-rolling a cache. That is the exact thing the library deletes.

---

## 1. REST idiom → TanStack DB primitive (the cheat sheet)

| REST thing you already know | TanStack DB primitive | Notes |
|---|---|---|
| `GET /things` (list) | a collection + `useLiveQuery(q => q.from(...))` | eager for small sets |
| `GET /things?limit&skip` (page) | on-demand `syncMode` + `loadSubsetOptions.limit/offset` | offset is **not** parsed — read raw (§7) |
| `GET /things/:id` (detail) | same collection + `.where(eq(id)).findOne()` | predicate drives the fetch (§4) |
| `GET /things/:id` returns more fields | optional schema fields + on-demand load | the "lean list / fat detail" problem (§4) |
| nested object in response (`dimensions`) | leave embedded, read in render | value object (§5a) |
| nested array of entities (`reviews`) | **Includes** (nested subquery) or own collection (§5b) |
| `?expand=author` / sideloading | a **join** across collections (§6) |
| `GET /things/category/:slug` (filtered list) | predicate push-down in `queryFn` (§7) |
| `?q=` full-text search | **gotcha** — `like`/`or` throw in the parser (§7, PP-3) |
| `POST/PUT/DELETE` | `onInsert/onUpdate/onDelete` + optimistic mutate (§8) |
| dashboard joining 3 endpoints | one live query, multiple joins/includes (§9) |

---

## 2. Schemas (zod — matches the otterdeploy stack)

```typescript
// product.schema.ts
import { z } from 'zod'

export const reviewSchema = z.object({
  rating: z.number(), comment: z.string(), date: z.string(),
  reviewerName: z.string(), reviewerEmail: z.string(),
})
export const dimensionsSchema = z.object({ width: z.number(), height: z.number(), depth: z.number() })
export const metaSchema = z.object({ createdAt: z.string(), updatedAt: z.string(), barcode: z.string(), qrCode: z.string() })

// The FULL product (what GET /products/:id returns)
export const productSchema = z.object({
  id: z.number(),
  title: z.string(),
  description: z.string(),
  category: z.string(),                 // a category SLUG — the FK to categoriesCollection
  price: z.number(),
  discountPercentage: z.number(),
  rating: z.number(),
  stock: z.number(),
  tags: z.array(z.string()),
  brand: z.string().optional(),         // not every product has a brand
  sku: z.string(),
  weight: z.number(),
  dimensions: dimensionsSchema,
  warrantyInformation: z.string(),
  shippingInformation: z.string(),
  availabilityStatus: z.string(),
  reviews: z.array(reviewSchema),
  returnPolicy: z.string(),
  minimumOrderQuantity: z.number(),
  meta: metaSchema,
  images: z.array(z.string()),
  thumbnail: z.string(),
})
export type Product = z.infer<typeof productSchema>

export const categorySchema = z.object({ slug: z.string(), name: z.string(), url: z.string() })
export type Category = z.infer<typeof categorySchema>
```

```typescript
// api.ts — thin fetch layer; the ENVELOPE unwrap lives here, nowhere else
const BASE = 'https://dummyjson.com'
async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`${res.status} ${path}`)   // throw → collection/handler can roll back
  return res.json() as Promise<T>
}
type ProductList = { products: Product[]; total: number; skip: number; limit: number }

export const productsApi = {
  list:       (qs = '')               => get<ProductList>(`/products${qs}`),
  byId:       (id: number)            => get<Product>(`/products/${id}`),
  search:     (q: string, qs = '')    => get<ProductList>(`/products/search?q=${encodeURIComponent(q)}${qs}`),
  categories: ()                      => get<Category[]>(`/products/categories`),
  byCategory: (slug: string, qs = '') => get<ProductList>(`/products/category/${slug}${qs}`),
}
```

---

## 3. Scenario A — the plain list (eager)

~194 products total → load all, query locally. **Unwrap the envelope in `queryFn`** (PP-1).

```typescript
// collections.ts
import { createCollection } from '@tanstack/react-db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'
import { QueryClient } from '@tanstack/query-core'

export const queryClient = new QueryClient()

export const productsCollection = createCollection(
  queryCollectionOptions({
    queryClient,
    queryKey: ['products'],
    queryFn: async () => (await productsApi.list('?limit=0')).products,  // limit=0 = all; return the ARRAY
    getKey: (p) => p.id,
    schema: productSchema,
  })
)
```

```tsx
function ProductGrid() {
  const { data } = useLiveQuery((q) =>
    q.from({ p: productsCollection }).orderBy(({ p }) => p.rating, 'desc').limit(20)
  )
  return <>{data.map((p) => <Card key={p.id} product={p} />)}</>
}
```

---

## 4. Scenario B — lean list + fat detail (THE core problem)

DummyJSON's list and detail return the *same* shape, but you simulate the real-world
"list is a summary, detail is richer" split with `?select=`. Two strategies — pick by §"decision table".

### Strategy 1 — ONE on-demand collection, predicate drives the endpoint (recommended)

This is the maintainer-recommended pattern from
[discussion #1145](https://github.com/TanStack/db/discussions/1145): use an on-demand collection and read
the `where` predicate out of `loadSubsetOptions` to decide *what* to fetch.

**Always pass `queryKey` as a FUNCTION.** The source checks the function branch *before* it ever reads
`syncMode` (`query.ts: generateQueryKeyFromOptions`), so a key-builder behaves identically in eager and
on-demand — `syncMode` can never cause a key collision. This is the canonical, mode-independent pattern;
do not rely on the static-key + on-demand auto-append behaviour.

```typescript
// products-key.ts — mode-independent key builder. Same output whatever the syncMode.
import { parseLoadSubsetOptions } from '@tanstack/db'
const BASE = ['products'] as const

export function productsQueryKey(opts?: { where?: unknown; orderBy?: unknown; limit?: number }) {
  if (!opts || (!opts.where && !opts.orderBy && opts.limit == null)) return [...BASE] // baseKey === fn({})
  let parsed
  try { parsed = parseLoadSubsetOptions(opts as any) }                                // throws on OR/like (PP-3)
  catch { return [...BASE, 'subset', { where: opts.where, orderBy: opts.orderBy, limit: opts.limit }] }
  const { filters, sorts, limit } = parsed
  const idEq = filters.find((f) => f.field.join('.') === 'id' && f.operator === 'eq')
  if (idEq && filters.length === 1) return [...BASE, 'detail', idEq.value]            // ['products','detail',5]
  return [...BASE, 'list', { filters, sorts, limit }]                                 // distinct filters → distinct entries
}
```

```typescript
import { parseLoadSubsetOptions } from '@tanstack/db'
import { productsQueryKey } from './products-key'

export const productsCollection = createCollection(
  queryCollectionOptions({
    queryClient,
    queryKey: productsQueryKey,       // FUNCTION form → syncMode irrelevant for keys
    syncMode: 'on-demand',            // flip to 'eager' freely; keys stay correct
    staleTime: 5 * 60_000,            // governs BACK-NAV refetch (the real bust) — see §4.1 note
    gcTime: 10 * 60_000,
    getKey: (p) => p.id,
    schema: productSchema,
    queryFn: async (ctx) => {
      const opts = ctx.meta?.loadSubsetOptions
      let filters: any[] = [], limit: number | undefined
      try { ({ filters, limit } = parseLoadSubsetOptions(opts)) } catch { /* OR/like → fetch broad (PP-3) */ }
      const idEq = filters.find((f) => f.field.join('.') === 'id' && f.operator === 'eq')
      if (idEq) return [await productsApi.byId(Number(idEq.value))]   // detail → ONE object, wrapped (PP-11)
      const offset = (opts as any)?.offset                           // offset NOT in parse output (PP-4)
      const qs = limit ? `?limit=${limit}${offset ? `&skip=${offset}` : ''}` : '?limit=0'
      return (await productsApi.list(qs)).products                   // list (eager: opts empty → all)
    },
  })
)
```

In **eager** mode this collection loads once under `['products']`, filters locally, and never calls the
detail endpoint (every row is already present). In **on-demand** mode detail → `['products','detail',5]`
and list → `['products','list',{…}]` — distinct, readable, no collision. Switching modes needs zero key
changes.

Both views are live queries against the **same** collection:

```tsx
// LIST — broad predicate → queryFn fetches /products
useLiveQuery((q) => q.from({ p: productsCollection }).limit(20))

// DETAIL — eq(id) predicate → queryFn fetches /products/:id; the fat object lands in the SAME row
useLiveQuery((q) =>
  q.from({ p: productsCollection }).where(({ p }) => eq(p.id, id)).findOne()  // → Product | undefined
)
```

`.findOne()` is the documented single-row reader (returns `T | undefined`, not an array).
For an already-loaded row with no fetch, use `productsCollection.get(id)` directly.

#### Why this is NOT the cache-bust you feared (verified in source)

Reusing one `queryKey` for two different endpoints *would* clobber the cache **in eager mode** — that
instinct is correct. It does **not** happen in on-demand mode, because the collection derives a distinct key
per subset. Literal code, `packages/query-db-collection/src/query.ts`:

```javascript
const generateQueryKeyFromOptions = (opts) => {
  if (typeof queryKey === 'function') {
    return queryKey(opts)                                  // you may control it explicitly
  } else if (syncMode === 'on-demand') {
    // append serialized predicates → separate cache entries per predicate combination
    const serialized = serializeLoadSubsetOptions(opts)
    return serialized !== undefined ? [...queryKey, serialized] : queryKey
  } else {
    return queryKey                                        // eager: used as-is (← the clobber lives here)
  }
}
```

So your two views hash to **different** keys, each with its own `QueryObserver`:

```
List   →  ['products', '{"limit":20}']
Detail →  ['products', '{"where":<eq(id,5)>}']
```

(`serializeLoadSubsetOptions` JSON-stringifies where/orderBy/limit/offset — `serialization.ts`.)

**But "does it bust on back-navigation?" is a SEPARATE question, and the honest answer is: it can.**
Two caches with different lifetimes are in play:

1. **TanStack DB's normalized row store** (the collection). On unmount, the list subset's refcount → 0 and
   `cleanupQueryInternal` (`query.ts`) **deletes** every row that no other subset still owns —
   `rowsToDelete.forEach((row) => write({ type: 'delete', value: row }))`. So the store *does* empty out.
2. **TanStack Query's QueryCache** (raw result per key). It survives for `gcTime`. On return the observer
   checks `queryClient.getQueryData(key)`: if present → rehydrate, **no network**; if evicted → real fetch.

| Time away | Result on back-nav |
|---|---|
| within `staleTime` | rehydrate from cache, **no network** |
| past `staleTime`, within `gcTime` | instant cache render **+ background refetch fires** |
| past `gcTime` | full refetch + loading state (**the bust**) |

TanStack Query's **default `staleTime` is `0`**, so with defaults a network request fires on *every*
back-navigation (no UI flash, but a request goes out). The list↔detail key derivation prevents
*clobbering*; it does **not** prevent back-nav refetch. The lever for that is `staleTime`/`gcTime` — which
is exactly why they're set in the config above.

If you want readable keys, pass the **function form** (validated to keep the `['products']` prefix):

```typescript
queryKey: (opts) => {
  const byId = opts.where && /* extract eq(id) */ undefined
  return byId ? ['products', 'detail', byId] : ['products', 'list']
},
```

### Strategy 2 — two collections (only when detail is a genuinely separate/heavier resource)

Keep a lean list collection and a separate detail collection. **The detail collection MUST use its own
distinct key** (`['product', id]`), or it collides with the list — this is the eager-mode clobber, and here
it's on you to avoid it:

```typescript
export const productDetailsCollection = createCollection(
  queryCollectionOptions({
    queryClient,
    queryKey: ['product-details'],     // distinct namespace from ['products']
    syncMode: 'on-demand',
    queryFn: async (ctx) => {
      const { filters } = parseLoadSubsetOptions(ctx.meta?.loadSubsetOptions)
      const byId = filters.find((f) => f.field.join('.') === 'id' && f.operator === 'eq')
      return byId ? [await productsApi.byId(Number(byId.value))] : []
    },
    getKey: (p) => p.id,
    schema: productSchema,
  })
)
```

**Use Strategy 1** when list & detail are the same entity at different fidelity (this is the common case).
**Use Strategy 2** when detail is a different/heavier resource you want to version independently.

---

## 5. Scenario C — nested / "included" data inside the response

### 5a. Value objects (`dimensions`, `meta`, `images`) → leave embedded

Always fetched with the parent, never mutated alone, never paginated → just read them:

```tsx
<Dims d={product.dimensions} /><Gallery images={product.images} />
```

### 5b. Entity arrays (`reviews`) → **Includes** (nested subquery), or normalize + join

If you want each product to carry a *nested* array of its reviews (the "included resources" shape from
classic REST sideloading), use **Includes** — a subquery inside `.select()`:

```tsx
const productsWithReviews = useLiveQuery((q) =>
  q.from({ p: productsCollection }).select(({ p }) => ({
    id: p.id,
    title: p.title,
    reviews: q
      .from({ r: reviewsCollection })
      .where(({ r }) => eq(r.productId, p.id))      // correlation MUST be eq() (PP-15)
      .select(({ r }) => ({ rating: r.rating, comment: r.comment })),
  }))
)
// → each row: { id, title, reviews: Collection }  (nested, not flattened)
```

This needs a `reviewsCollection`. DummyJSON reviews **have no id** → synthesize a stable composite key
(PP-7):

```typescript
type ReviewRow = Review & { id: string; productId: number }
export const reviewsCollection = createCollection(
  queryCollectionOptions({
    queryClient,
    queryKey: ['reviews'],
    queryFn: async () => {
      const { products } = await productsApi.list('?limit=0&select=reviews')
      return products.flatMap((p) =>
        p.reviews.map((r, i) => ({ ...r, productId: p.id, id: `${p.id}:${i}` }))  // ⚠ index key (PP-7)
      )
    },
    getKey: (r) => r.id,
  })
)
```

**Rule:** value object → embed. Entity array you sort/filter/mutate → its own collection + Include/join.

---

## 6. Scenario D — related resource via a separate endpoint → join

`product.category` is a slug; `GET /products/categories` is the lookup table. Join on the slug instead of
inventing a "product-with-category-name" endpoint:

```typescript
export const categoriesCollection = createCollection(
  queryCollectionOptions({
    queryClient, queryKey: ['categories'],
    queryFn: () => productsApi.categories(),   // returns the array directly — no envelope
    getKey: (c) => c.slug,
  })
)
```

```tsx
const { data } = useLiveQuery((q) =>
  q.from({ p: productsCollection })
   .innerJoin({ c: categoriesCollection }, ({ p, c }) => eq(p.category, c.slug))  // equality only (PP-16)
   .where(({ p }) => eq(p.id, id))
)
const row = data[0]   // { p: Product, c: Category }  — flat, namespaced by alias
```

Join types: `leftJoin` (default `join`), `rightJoin`, `innerJoin`, `fullJoin`. Result is a **flat**
namespaced row `{ p, c }`; the joined side's optionality follows the join type (`inner` → present,
`left` → `c?`). For **nested** output use Includes (§5b) instead.

---

## 7. Scenario E — search / filter / sort / paginate (predicate push-down + its sharp edges)

In on-demand mode the live query's predicates arrive in `queryFn` and you map them to API params. But the
parser has hard limits you **must** know.

`parseLoadSubsetOptions(opts)` returns exactly (verified, `expression-helpers.ts`):

```typescript
{
  filters: [{ field: ['category'], operator: 'eq', value: 'electronics' },
            { field: ['price'], operator: 'lt', value: 100 },
            { field: ['email'], operator: 'isNull' }],   // null checks carry no `value`
  sorts:   [{ field: ['price'], direction: 'asc', nulls: 'last' }],
  limit:   10,
  // NOTE: no `offset` — read it from ctx.meta.loadSubsetOptions.offset directly (PP-4)
}
```

Supported `operator`s (and their `not_` variants): `eq, gt, gte, lt, lte, in, isNull, isUndefined`,
`not_eq, not_gt, …`. That's it.

**The trap:** `extractSimpleComparisons` (which `parseLoadSubsetOptions` calls) **throws** on `or()` and on
complex/nested expressions — its own docstring says *"Throws an error if it encounters unsupported
operations like OR."* So `like` / `ilike` / `or` — i.e. exactly what full-text search compiles to — will
blow up the parse. The production-safe shape (mirroring their own e2e test `query-filter.ts`) is
**try/catch with a fallback**:

```typescript
queryFn: async (ctx) => {
  const raw = ctx.meta?.loadSubsetOptions
  let filters = []
  try {
    filters = parseLoadSubsetOptions(raw).filters       // fast path: simple AND-ed comparisons
  } catch {
    filters = []                                         // OR/like/complex → fall back, fetch broad
  }

  const cat = filters.find((f) => f.field.join('.') === 'category' && f.operator === 'eq')
  if (cat) return (await productsApi.byCategory(String(cat.value))).products   // GET /products/category/:slug

  // search & everything else: fetch broad, let the live-query WHERE filter locally
  return (await productsApi.list('?limit=0')).products
}
```

Two more realities of mapping predicates to a *real* REST API:

- **The API can't express every predicate.** DummyJSON has no arbitrary field filter (no `price<100`
  endpoint). That's fine for *correctness*: the live query's `where` always re-filters the in-memory result,
  so you never show wrong rows — you only **over-fetch**. Push what the API supports, accept local filtering
  for the rest. (PP-5)
- **At ~194 rows, don't bother with on-demand at all.** Eager-load once and do all filter/sort/paginate
  locally — it's sub-millisecond and sidesteps every parser limit above. Reserve on-demand for genuinely
  large/uncapped datasets. (PP-5)

---

## 8. Scenario F — mutations (optimistic + rollback)

```typescript
queryCollectionOptions({
  // ...
  onInsert: async ({ transaction }) => {
    await Promise.all(transaction.mutations.map((m) =>
      fetch(`${BASE}/products/add`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(m.modified) })))           // m.modified = full new row
  },
  onUpdate: async ({ transaction }) => {
    await Promise.all(transaction.mutations.map((m) =>
      fetch(`${BASE}/products/${m.original.id}`, { method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(m.changes) })))            // m.changes = ONLY the diff (PP-9)
  },
  onDelete: async ({ transaction }) => {
    await Promise.all(transaction.mutations.map((m) =>
      fetch(`${BASE}/products/${m.original.id}`, { method: 'DELETE' })))
  },
})
```

```tsx
productsCollection.update(id, (d) => { d.stock -= 1 })   // instant UI; PUT in background; auto-rollback on throw
productsCollection.insert({ id: Date.now(), /* ... */ })
productsCollection.delete(id)
```

Mutation handler payload: `m.modified` (full new object), `m.changes` (diff only), `m.original`
(pre-mutation row). Use `changes` for PATCH/PUT-diff, `modified` for POST/PUT-full.

---

## 9. Scenario G — the dashboard (everything composed)

One live query, several sources — each reactive, each shared with every other view:

```tsx
const { data: head } = useLiveQuery((q) =>
  q.from({ p: productsCollection })
   .innerJoin({ c: categoriesCollection }, ({ p, c }) => eq(p.category, c.slug))
   .where(({ p }) => eq(p.id, id)))

const { data: reviews } = useLiveQuery((q) =>
  q.from({ r: reviewsCollection })
   .where(({ r }) => eq(r.productId, id))
   .orderBy(({ r }) => r.date, 'desc'))
```

Update stock in §8 and the dashboard, the grid, and every card re-render from the same row.

---

## 10. THE PAIN-POINT CATALOG — where it breaks and how to fix it

Each entry: **symptom → root cause → fix**. Grounding noted; ⚠ = inference from the engine model, not a
direct doc quote.

| # | Pain point | Symptom | Root cause | Fix |
|---|---|---|---|---|
| **PP-1** | Envelope not unwrapped | `getKey` on `undefined`, schema fails, 0 rows | API returns `{products:[…]}` not an array | Unwrap in `queryFn` (`(await api.list()).products`) **or** `select: (r) => r.products`. Categories endpoint returns a bare array — don't unwrap that one. |
| **PP-2** | Shared key clobber | Detail load wipes the list cache entry | **Eager** mode uses `queryKey` as-is, so two endpoints under one static key overwrite each other | Pass `queryKey` as a **function** (§4.1 `productsQueryKey`). The function branch is checked before `syncMode`, so it's mode-independent and never collides. (`query.ts: generateQueryKeyFromOptions`) |
| **PP-2b** | Back-nav refetch | Returning to the list fires a network request | On unmount the store rows are GC'd (`cleanupQueryInternal`); QueryCache survives only `gcTime`; default `staleTime` is `0` → always revalidates | This is normal & tunable — **not** a key collision. Raise `staleTime` to skip the network on return; raise `gcTime` to keep the entry longer. (§4.1 table) |
| **PP-3** | Search predicate throws | `queryFn` crashes on `?q=`/`or()`/`like` | `extractSimpleComparisons` **throws on OR/complex**; only AND-ed simple comparisons parse | try/catch around `parseLoadSubsetOptions`, fall back to broad fetch + local filter (their own e2e pattern). (`expression-helpers.ts`) |
| **PP-4** | Missing `offset` | Pagination skips nothing / wrong page | `parseLoadSubsetOptions` returns `{filters, sorts, limit}` — **no offset** | Read `ctx.meta.loadSubsetOptions.offset` directly. (`expression-helpers.ts` return type; `serialization.ts` proves offset exists on the raw object) |
| **PP-5** | API can't express the predicate | Over-fetching; "filter ignored" | DummyJSON (and most REST) lack arbitrary field filters | Correctness is safe — the live-query `where` re-filters locally. Push what's supported; accept local filtering. At <10k rows, just go eager. ⚠ (local-refilter is the engine model) |
| **PP-6** | Join/include sees only loaded rows | Join returns partial/empty results | Joins compute over the **in-memory** normalized store; an on-demand related collection may not have loaded the matching rows yet | Make the *related* (lookup) collection **eager**, or trigger its load before the join, or denormalize the field onto the parent. ⚠ |
| **PP-7** | Nested entity has no id | Reviews collapse/duplicate; wrong row updates | `getKey` needs a stable unique key; DummyJSON reviews have none | Synthesize `${productId}:${index}` — but index keys break on reorder/insert; prefer a server id if one ever exists. |
| **PP-8** | Optimistic write vs non-persisting API | Insert appears then vanishes on next sync | Server didn't actually persist (DummyJSON simulates); next refetch reconciles it away | Expected with fake APIs. With a real API: handler must succeed; **throw in the handler → automatic rollback**. Don't swallow errors. |
| **PP-9** | Wrong mutation field | PUT sends whole object / PATCH sends nothing | Confusing `m.modified` (full) vs `m.changes` (diff) vs `m.original` | `changes` for PUT/PATCH-diff, `modified` for POST/PUT-full, `original.id` for the URL. |
| **PP-10** | id type mismatch | `eq(p.id, routeId)` matches nothing; detail blank | Route params are strings; DummyJSON `id` is a number | Coerce: `eq(p.id, Number(routeId))`. Keep `getKey` and predicates the same type. |
| **PP-11** | Detail returns object not array | `queryFn` result rejected | `queryFn` must return `Array<T>`; `/products/:id` returns one object | Wrap it: `return [await api.byId(id)]`. |
| **PP-12** | Lean-row reads a fat field | `product.reviews` is `undefined` on list rows | List subset was `?select=`-trimmed; fat fields only arrive when the detail subset loads | Make heavy fields `.optional()` and guard in UI, **or** don't trim the list, **or** trigger the detail load before reading. |
| **PP-13** | gcTime eviction | Returning after a while refetches | Each subset is its own cache entry; refcount→0 + `gcTime` GCs the rows (`unloadSubset`) | Tune `staleTime`/`gcTime` to the navigation pattern. (`query.ts` refcount layer) |
| **PP-14** | Buggy predicate→param mapping | Cache "hit" returns the *wrong* data | The cache key encodes the serialized predicate; a wrong mapping caches wrong rows under a correct-looking key | Unit-test the mapping; assert fetched rows actually satisfy the predicate before returning. |
| **PP-15** | Include without correlation | Nested array empty or cross-joined | The child subquery's `.where()` lacks an `eq()` linking child→parent | Always include the correlation `eq(child.parentId, parent.id)`. (live-queries docs) |
| **PP-16** | Non-equality join | "join only supports equality" | Joins are equality-only by design | Pre-filter with a subquery/`where`, then equality-join; or denormalize the comparison key. (live-queries docs) |
| **PP-17** | Collection created in a component | Cache resets every render; flashing/refetch | Collections are singletons; re-creating drops their store | Define every `createCollection` at **module level**. (skill best practice) |
| **PP-18** | Forgot to mount the lookup collection | Category name blank in the join | `categoriesCollection` never queried → never loaded → nothing to join | Ensure the related collection is referenced by *some* live query (or eager) so it loads. ⚠ |
| **PP-19** | Eager on a huge resource | Slow first paint, memory blow-up | Eager loads the whole collection up front | Switch to `syncMode: 'on-demand'` above ~10k rows; eager only for small/static sets. (skill guidance) |

---

## 11. The decision table (pin this above your desk)

| Situation | Do |
|---|---|
| List & detail are the same entity, different fidelity | One **on-demand** collection, predicate-derived keys (§4.1) |
| Detail is a genuinely separate/heavier resource | Two collections, **distinct keys** (§4.2) |
| Nested value object (dimensions/meta) | Embed, read in render (§5a) |
| Nested entity array (reviews) you sort/filter/mutate | **Include** (nested) or own collection + join (§5b) |
| Related lookup from another endpoint (categories) | Own collection + **equality join** on the FK (§6) |
| Filter/sort/paginate, < ~10k rows | **Eager** + local live query — skip the parser entirely (§7) |
| Filter/sort/paginate, huge/uncapped | **On-demand** + `parseLoadSubsetOptions`, **with try/catch** (§7) |
| Full-text search | Broad fetch + local `where` filter; never rely on the parser for `like`/`or` (§7, PP-3) |
| Create/edit/delete | Optimistic `insert/update/delete` + handlers; throw to roll back (§8) |
| A screen needs several resources | One live query, multiple joins/includes (§9) |

**The single habit that prevents the most pain: one collection per *resource*, never per *view*.
Views are live queries.** Everything else here is a footnote to that.

---

### Sources
- Maintainer single-item pattern — TanStack/db Discussion #1145
- On-demand RFC — TanStack/db Discussion #676
- Query-driven sync — `tanstack.com` blog `tanstack-db-0.5-query-driven-sync`
- Verified source: `packages/db/src/query/expression-helpers.ts` (`parseLoadSubsetOptions`, `extractSimpleComparisons`),
  `packages/query-db-collection/src/query.ts` (`generateQueryKeyFromOptions`, refcount/GC),
  `packages/query-db-collection/src/serialization.ts` (`serializeLoadSubsetOptions`),
  `packages/query-db-collection/e2e/query-filter.ts` (try/catch mapping pattern)
- Joins & Includes — `tanstack.com/db/latest/docs/guides/live-queries`
