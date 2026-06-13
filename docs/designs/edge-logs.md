# Edge Access Logs

**Status:** Implemented — live ring buffer + DB persistence (Phase 2). GeoIP is a wired stub
(needs a MaxMind database); upstream/cache fields await a `reverse_proxy`-logging / cache layer.

**Last verified:** 2026-06-10

**TL;DR:** A live tail of every HTTP request that hit the Caddy edge proxy — method, status,
host, path, latency, client IP, user-agent, TLS — with a status-class volume histogram, filters
(time range / method / status / host / search), expandable per-request detail, and a per-host
RPS/error%/p50/p95/p99 footer. v1 is **in-memory**: Caddy emits structured JSON access logs via a
per-site `log { output net … }`, the control-plane server's TCP sink parses them into a bounded ring
buffer, and oRPC serves a live tail (event-iterator) plus a range query (histogram + percentiles
computed in JS). No DB table — matches the tail-oriented competitor approach
([[competitor-observability]]) and the streaming convention ([[streaming-transport-convention]]).
Persistence (24h/7d ranges, survival across restarts), GeoIP country flags, and upstream/cache
fields are Phase 2.

---

## 1. Mental model

Two layers, one stream:

```
Caddy site block            control-plane server                    web
  log {                       TCP sink (Bun.listen)  ─┬─ ring buffer ── oRPC edgeLogs.query ── histogram+table+footer
    output net <sink>           parse Caddy JSON      └─ pub/sub ─────── oRPC edgeLogs.tail  ── (live)
    format json               → EdgeLogLine
  }
```

Access logging is **opt-in per environment**: only when `EDGE_LOG_SINK` is set does the Caddyfile
carry `output net`, and only then does the server bind its sink. Unset ⇒ the Edge Logs page shows
an empty live tail (no error).

## 2. Transport — Caddy → server

`buildHttpBlock` (`packages/api/src/caddy/builder.ts`) emits, for every HTTP site, when
`edgeLogSink` is threaded through reconcile:

```caddyfile
log {
  output net host.docker.internal:9100
  format json
}
```

`output net` is symmetric across environments (dev: `host.docker.internal`; Swarm: server service
DNS) — the same pattern as `DEPLOY_AUTHZ_UPSTREAM`, no shared-filesystem assumption. The server binds
the listener (`startEdgeLogSink`, `EDGE_LOG_PORT`, default 9100) in `bootstrap()`; Caddy connects and
streams newline-delimited JSON. `parseCaddyAccessLog` normalizes each entry (TLS numeric codes →
strings, `remote_addr` port-strip, unix-float ts → ISO) and returns null for Caddy's own runtime log
lines that share the stream.

## 3. Store — in-memory ring + pub/sub

`packages/api/src/edge-logs/ring.ts`: a bounded buffer (`MAX_ENTRIES = 50k`) plus a `Set` of live
subscribers. `pushEdgeLog` appends + fans out. `queryEdgeLogs(filter, now)` filters by the caller's
hosts + range/method/status/search and computes the histogram (~40 buckets) and per-host
percentiles in JS. One edge proxy, one process ⇒ a module singleton is correct.

## 4. API — `edgeLogs` router

`packages/api/src/routers/edge-logs/` (org-scoped, added to `appRouter`):

- `query` — input `{ projectId?, range, method?, status?, host?, search?, limit? }` → `{ rows,
  histogram, hostStats, total }`. Hosts resolved server-side: `listProjectDomains` (org-verified) or
  `listOrgDomains`. Clients never pass hosts — that's the multi-tenant guard.
- `tail` — event-iterator bridging the ring's pub/sub into an abortable async generator with a small
  backpressure queue, filtered to the org's (optionally one project's) domains.

The web route polls `query` every 2s while "live" (simpler + serves histogram/stats from one source);
`tail` is available for a future true-push table.

## 5. Frontend

`apps/web/src/routes/_app/$orgSlug/$projectSlug/edge-logs.tsx` + a project nav tab. Header with live
toggle, segmented filters, CSS volume histogram (stacked by status class), expandable log rows, and
the per-host footer. Project-scoped via the route's `projectId`.

## 6. Persistence (implemented)

`edge_log` table (`packages/db/src/schema/edge-log.ts`, bigserial PK, `(host, ts)` index) + a
batched writer (`persist.ts`: flush on interval/fill, hourly retention sweep at 7d) behind the live
ring. When `EDGE_LOG_PERSIST` is on (default whenever the sink is configured), the `query` handler
reads from the DB (`query-db.ts`) — so 24h/7d ranges and percentiles work and survive restarts;
otherwise it falls back to the in-memory ring. The DB query fetches up to `MAX_FETCH` recent rows in
the window and reuses `summarizeEdgeLogs`, so stats are exact at low/medium volume; moving the
aggregates into SQL (`percentile_cont`) is the next step if volume demands it.

### Remaining Phase 2

- **GeoIP** — `geo.ts` is a wired stub (`lookupCountry` → null); dropping in a MaxMind GeoLite2
  reader (gated on a DB path) lights up the `country` flag end-to-end.
- **Upstream / cache** — `reverse_proxy` upstream logging + a cache layer (souin) to populate
  `upstream` and a `cache HIT/MISS` field (plumbed, currently null/absent).
- **Per-minute rollups** — pre-aggregate counts/percentiles so high-volume 7d windows don't scan
  raw rows.

## 7. Where this lives in code

| Concern | Location |
|---|---|
| Parse / ring / ingest / types | `packages/api/src/edge-logs/` |
| Caddy `log` directive | `packages/api/src/caddy/builder.ts` (`buildHttpBlock`, `edgeLogSink`) |
| Sink bind | `apps/server/src/index.ts` (`startEdgeLogSink`) |
| Env | `EDGE_LOG_SINK`, `EDGE_LOG_PORT` (`packages/env/src/server.ts`) |
| oRPC router + contract | `packages/api/src/routers/edge-logs/` |
| UI route + nav | `apps/web/.../$projectSlug/edge-logs.tsx`, `project-tabs.tsx` |
