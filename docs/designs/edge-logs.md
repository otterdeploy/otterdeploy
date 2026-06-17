# Edge Access Logs

**Status:** Implemented — live ring buffer + DB persistence (Phase 2). GeoIP is a wired stub
(needs a MaxMind database); upstream/cache fields await a `reverse_proxy`-logging / cache layer.
**Phase 3 (operational log plane — cert/ACME + upstream-error events) is implemented as a live tail
(no persistence yet); promoting cert events into per-domain state is still future work.**

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

## 7. Phase 3 — the operational log plane (implemented, live-tail)

Everything above is the **access** plane: one structured line per HTTP request, emitted by Caddy's
per-site `log { output net }`. Caddy has a *second*, entirely separate stream — its **default
logger** (process stderr), which carries the proxy's own operational events:

```
2026-Jun-15 15:28:17 {"level":"error","logger":"http","msg":"looking up info for HTTP challenge",
  "host":"www.somnara.de","error":"no information found to solve challenge for identifier: www.somnara.de"}
2026-Jun-15 16:13:42 {"level":"error","logger":"http.handlers.reverse_proxy",
  "msg":"aborting with incomplete response","upstream":"10.0.6.7:3000","error":"reading: context canceled"}
2026-Jun-15 15:28:56 {"level":"info","logger":"http","msg":"enabling automatic TLS certificate management","domains":[…]}
```

By default these never touch the `output net` sink — that directive only attaches to the access
logger, so the default logger goes to the container's stdout. Phase 3 adds a **global** `log` block
(`buildCaddyfile`/`buildProjectFragment`, gated on the same `edgeLogSink`) that ships the default
logger to the same sink, where it's parsed into events.

### 7.1 Why this is the half that matters

The access plane tells you *a request got a 502*. The operational plane tells you **why the edge
itself is failing** — and those are the questions a self-host PaaS actually gets paged about:

| Logger | Event | Product surface it feeds |
|---|---|---|
| `tls` / `http` (ACME) | cert issued / renewed / **challenge failed** | per-domain cert status on the **domains-card** ([[multi-domain-services]]) |
| `http.handlers.reverse_proxy` | upstream dial error, `incomplete response`, `context canceled` | **service health** (distinct from the app's own logs) |
| `http` / `admin.api` | config reload (`New Config JSON`, `/load`) | confirmation that an Apply actually took at the edge |
| `tls` | OCSP stapling warnings | domain diagnostics |

"My domain won't go HTTPS" is the #1 reverse-proxy support question, and the answer is *only* in
this stream — the ACME challenge error names the exact host with no route/DNS. That pairs directly
with **ADD-AND-GO** ([[multi-domain-services]]): today the domains-card relies on a DNS reachability
probe; the cert-lifecycle events are the authoritative signal it should be driven by.

### 7.2 Transport — global `log { output net }`, parsed by `logger`/`level`

Same streaming transport ([[streaming-transport-convention]]) as access logs, **same sink port** —
no second listener, no new env var. `buildCaddyfile`/`buildProjectFragment` emit a global log block
when `edgeLogSink` is set:

```caddyfile
{
  log {
    output net <sink>
    format json
  }
}
```

Access logs (per-site `http.log.access.*` logger) and operational events (the default logger) then
interleave on one socket. `ingest.ts` splits them up front (`isAccessLog`: `http.log.access` logger
or `msg:"handled request"`) — without this, a reverse_proxy error (which embeds a `request`) would
mis-parse as a status-0 access row. Non-access lines go to `parseCaddyEvent` (`event-parse.ts`),
which dispatches on `logger`/`msg` into an `EdgeEventLine`
(`{ ts, level, category, logger, msg, host, domains, upstream, error, raw }`) and **drops info-level
noise** that isn't cert (reloads, admin-api chatter, lifecycle) so the bounded ring stays high-signal.

### 7.3 Store, API, surfaces

- **Store** — a second bounded ring (`event-ring.ts`, `MAX_EVENTS = 5k`) mirroring `ring.ts`, with
  its own pub/sub. **Live-tail only** for v1 (no `edge_event` table) — matching the original
  access-log v1; durable cert-failure history can reuse §6's partition machinery later.
- **API** — `edgeLogs.events.query` / `edgeLogs.events.tail`, org-scoped by the same
  `listProjectDomains`/`listOrgDomains` guard. An event is visible iff one of its attributable hosts
  (its `host`, or any entry in a cert-batch `domains[]`) is in the caller's scope; batch `domains`
  are **redacted to the owned subset** so a box-wide cert line only shows this tenant's domains.
  Host-less infra events (config reloads, server lifecycle) are not surfaced in the org/project UI —
  an operator surface is future work.
- **Frontend** — the Edge Logs page is now tabbed (`edge-logs-page.tsx`): **Access** (the existing
  histogram/percentile view) and **Events** (`edge-events-view.tsx`) — a full-bleed event table with
  category/level/host filters and an expandable raw-JSON detail, following the [[page-layout-standard]]
  full-height instrument exception.
- **Not yet built — promote, don't just tail.** The high-value next step is feeding events into state
  rather than leaving them a second table: cert-lifecycle events → a `certState` on `proxy_route`
  beside `dnsState` on the domains-card ([[multi-domain-services]]) (a schema change → `db:push`), and
  `reverse_proxy` errors → a recent-edge-errors strip on the service/resource panel.

### 7.4 Note on caddy-docker-proxy / Coolify boxes

The reference logs that motivated this carried a `docker-proxy` logger and `coolify:*` upstreams —
i.e. a caddy-docker-proxy / Coolify-managed Caddy, not our Caddyfile generator. The gap is identical
for our own edge: same default-logger stream, equally uncaptured. The global `log` block above
applies to any Caddy we generate; a label-driven proxy would instead set the global log via its own
config, but the parse/store/API/surfaces (§7.2–7.3) are unchanged.

## 8. Where this lives in code

| Concern | Location |
|---|---|
| Parse / ring / ingest / types | `packages/api/src/edge-logs/` |
| Caddy `log` directive | `packages/api/src/caddy/builder.ts` (`buildHttpBlock`, `edgeLogSink`) |
| Sink bind | `apps/server/src/index.ts` (`startEdgeLogSink`) |
| Env | `EDGE_LOG_SINK`, `EDGE_LOG_PORT` (`packages/env/src/server.ts`) |
| oRPC router + contract | `packages/api/src/routers/edge-logs/` |
| UI route + nav | `apps/web/.../$projectSlug/edge-logs.tsx`, `project-tabs.tsx` |
| **Phase 3** global `log` block | `packages/api/src/caddy/builder.ts` (`edgeLogGlobalLines`, both global blocks) |
| **Phase 3** event parse / ring | `packages/api/src/edge-logs/event-parse.ts` (`parseCaddyEvent`), `event-ring.ts` |
| **Phase 3** access/event split | `packages/api/src/edge-logs/ingest.ts` (`isAccessLog`) |
| **Phase 3** API | `packages/api/src/routers/edge-logs/` (`events.query` / `events.tail`) |
| **Phase 3** UI | `apps/web/.../edge-logs/components/{edge-logs-page,edge-events-view}.tsx` |
| **Phase 3** env | none new — reuses `EDGE_LOG_SINK` / `EDGE_LOG_PORT` (same sink) |
| **Phase 3** cert/health surfaces | domains-card (`certState`), service panel error strip — *not yet built* |
