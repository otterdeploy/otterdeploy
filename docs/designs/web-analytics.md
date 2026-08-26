# Web Analytics (built-in, Open-class)

**Status:** Phases 1–2 implemented in the working tree (2026-08-26, not yet committed/deployed):
backend web plane + tracker, and the web UI with Overview / Realtime / Traffic / Events / Setup
views (Funnels is a "Coming soon" placeholder). Phase 3 = Funnels compute + UI; Phase 4 = Traffic
tab restyle, share links, weekly digest, day rollups for > 90-day windows. Tracking epic: `od-wgqa`. Owner decisions (2026-08-26): **Postgres only** (no ClickHouse), **site = project**,
**revenue deferred**.

**TL;DR:** otterdeploy gets a first-party product-analytics plane modelled on
[Open](https://getopen.so) (and the Plausible/Umami superset): a ~2 KB tracker script served by the
control plane, a public collect endpoint, cookieless daily-rotating visitor identity, in-process
sessionization (bounce, duration, entry/exit), custom events with conversion goals, realtime
presence, funnels, filters + period comparison, and a calm "Quiet Instrument" dashboard. It sits
next to (not on top of) the existing **traffic** plane (Caddy access logs → `edge_stat_*`), which
keeps answering "requests / latency / errors / bandwidth" — questions a script cannot.

---

## 1. Two planes, one page

```
                     ┌──────────────── control plane ────────────────┐
browser ──otter.js──►│ POST /a/c  → collect → sessionize → analytics_event / analytics_session │──► /analytics  Overview · Realtime · Events · Funnels
Caddy   ──access log►│ TCP sink  → fold      → edge_stat_minute / edge_stat_day                │──► /analytics  Traffic
                     └────────────────────────────────────────────────┘
```

| question | plane | source |
|---|---|---|
| visitors, pageviews, bounce, visit duration, entry/exit, sources/UTM, goals, funnels, realtime | **web** | tracker |
| requests, status mix, p50/p95/p99, bandwidth, bots, per-host | **traffic** | Caddy logs |

Both are scoped the same way: install-wide (admin) → org → project → host.

## 2. Site model

`analytics_site` is 1:1 with `project`, created lazily by `analytics.site.ensure` the first time
someone opens Setup. Its **public key** (`od_` + 32 hex) is what the snippet carries; it is public
by design (like a Plausible domain), so it is stored in clear and shown in the UI. Rotating mints a
new key; the old one stops being accepted immediately (60 s cache TTL at most).

Allowed hosts = the project's HTTP `proxy_route` domains ∪ `extra_hosts` (for sites fronted by
someone else's CDN). An event whose page URL host is outside the allowlist is dropped silently
(204) — counted in a per-site "rejected" counter surfaced on Setup, never persisted.

## 3. Tracker (`/a/otter.js`)

Served by the server from a route (never from `apps/web/public`), minified at first request by
`Bun.Transpiler`, `Cache-Control: public, max-age=3600`. Snippet:

```html
<script async src="https://<control-plane>/a/otter.js" data-key="od_…"></script>
```

Data attributes: `data-collector` (default: script origin), `data-hash-routing`,
`data-exclude-search` (drop `?query` before sending; default on), `data-respect-dnt` (default
off — DNT is dead; GPC is honoured **always**), `data-require-consent`, `data-domains` (only
send on these hosts; default: any), `data-auto-events` (`links,downloads`; default both on),
`data-debug`.

Global `window.otter`:
`track(name, props?)`, `pageview()`, `identify(id)`, `consent("granted"|"denied")`, `flush()`.
Attribute events: `data-otter-event="signup"` + `data-otter-prop-plan="pro"` on any element.

Automatic: pageview on load and on `pushState`/`replaceState`/`popstate` (same URL suppressed),
outbound-link clicks (`Outbound Link: Click`, prop `url`), file downloads (`File Download`,
prop `url`; extensions list), engagement beacon on `visibilitychange:hidden` / `pagehide` / route
change (`active_ms`, `visible_ms`, `scroll` max %), heartbeat every 30 s while visible (presence
only, never persisted), self-exclusion via `#otter-ignore` / `#otter-unignore` URL fragment
(localStorage flag). Batching: queue flushed after 1 s or on hide via `navigator.sendBeacon`
(`text/plain`, no preflight); retry queue in `sessionStorage` ≤ 100 events.

Wire format (`POST /a/c`, ≤ 64 KB, ≤ 50 events):

```jsonc
{ "k": "od_…", "v": 1, "sid": "<per-tab uuid>", "e": [
  { "id": "<uuid>", "t": "pv",  "ts": 1724650000000, "u": "https://…/pricing", "r": "https://google.com/", "ti": "Pricing", "sw": 1440, "l": "en-GB" },
  { "id": "<uuid>", "t": "ev",  "ts": …, "u": "…", "n": "signup", "p": { "plan": "pro" } },
  { "id": "<uuid>", "t": "eng", "ts": …, "u": "…", "a": 12400, "vis": 30100, "sc": 80 },
  { "id": "<uuid>", "t": "hb",  "ts": …, "u": "…" },
  { "id": "<uuid>", "t": "id",  "ts": …, "uid": "user_123" }
]}
```

Not on the wire: UTM (parsed server-side from `u`), IP, UA (headers). Query strings are stripped
server-side too (belt and braces) except UTM keys.

## 4. Collect → sessionize → write

`apps/server/src/handlers/analytics/*` adapts Hono → `packages/api/src/analytics/collect.ts`.
Registered **above** evlog / the credentialed CORS middleware (cheap path, `cors({origin:"*"})`,
no per-request wide event, `guard()`-wrapped so it can never throw). Body limit rule `/a/` → 64 KB.

Per batch: parse (`Result.try` + zod) → site by key (60 s LRU) → host allowlist → per-IP
sliding-window limiter (600/min) → per event:

1. **Bot?** `@otterdeploy/shared/ua` (same classifier as the traffic plane) → drop, count.
2. **Identity.** `visitor_id = HMAC-SHA256(k_day, site|utcDay|ip|browser|os|device)[:16 bytes]`,
   `k_day = HKDF(BETTER_AUTH_SECRET, info="otterdeploy/analytics/visitor/v1")`. Rotates at UTC
   midnight by construction; no per-visitor row ever stores an IP; stable across restarts (unlike
   the traffic plane's per-process salt). `identify(id)` → `external_user_id = HMAC(k, site|id)`.
3. **Enrich.** country (`edge-logs/geo.ts`), browser/os/device families (`edge-logs/analytics-ua.ts`),
   path (strip query except UTM, strip fragment, ≤ 512 chars), referrer host (`normalizeReferrer`,
   self-referrals → null = Direct), UTM ×5, screen width, language (2–5 chars).
4. **Sessionize** (in-process, `packages/api/src/analytics/sessionizer.ts`): key
   `(site, visitor, sid)`; 30-min inactivity, 24-h cap; on a miss, look up the most recent open
   session for `(site, visitor)` from the DB (restart survival) before creating. Pageview →
   `pageviews++`, `exit_path`; event → `events++`; `eng` → `active_ms += a`, `scroll = max`;
   `hb` → bumps the session's `last_at` only. First-touch referrer/UTM/entry path are frozen on
   creation. There is NO separate in-memory presence store (owner call, 2026-08-26): "live right
   now" is simply `analytics_session.last_at > now − 5 min`, which the 1 s writer flush keeps
   fresh and which survives restarts.
   `engaged = pageviews ≥ 2 ∨ events > 0 ∨ active_ms ≥ 10 000`; bounce = ¬engaged (Open's rule).
5. **Write** (`writer.ts`, `globalThis` state like `edge-logs/persist.ts`): 1 s batched
   `INSERT … ON CONFLICT DO NOTHING` into `analytics_event` (dedupe on client event id), batched
   `INSERT … ON CONFLICT DO UPDATE` into `analytics_session` (monotonic: `last_at = GREATEST`,
   counters `= excluded`), upsert `analytics_event_definition` (auto-registers names, bumps
   `last_seen_at`), bump `analytics_site.first_event_at` once.

Single-writer: like the traffic plane, the collector is one process. Documented; the session
upsert is written so a second writer would only cause lost counter updates, never corruption.

## 5. Storage

| table | managed by | key / retention |
|---|---|---|
| `analytics_site` | drizzle-kit | `asite_`, per project |
| `analytics_event` | runtime DDL, daily `RANGE (ts)` partitions (`analytics/partition.ts`, mirrors `edge-logs/partition.ts`) | PK `(id, ts)`; BRIN `ts`; btree `(site_id, ts)`, `(site_id, session_id)`; **400 days** (platform setting `analyticsRetentionDays`) |
| `analytics_session` | drizzle-kit | `ases_`; btree `(site_id, started_at)`, `(site_id, visitor_id, last_at)`; pruned with events |
| `analytics_event_definition` | drizzle-kit | `aevd_`; unique `(site_id, name)`; `conversion` flag, `display_name`, `archived_at` |
| `analytics_funnel` | drizzle-kit | `afun_`; `steps` jsonb, `scope`, `window_hours` |

`analytics_event` columns: `id, ts, site_id, session_id, visitor_id, kind ('pageview'|'event'),
name, props jsonb, host, path, referrer_host, utm_source/medium/campaign/term/content, country,
browser, os, device, screen_w, language`. Engagement and heartbeats are **not** rows.

No rollups in Phase 1: with partition pruning + `(site_id, ts)` the raw table answers 90-day
windows in well under a second at tens of millions of rows; a `analytics_day` rollup for
> 90-day windows is a Phase-4 knob behind the same query interface.

## 6. Query API (`analytics.*` oRPC router)

Shared input: scope `{ projectId? | installWide? }` (same authz as `edgeLogs.analytics`: install-wide
needs `install:read`; otherwise org-scoped, project must belong to the org), `range`
(`today|yesterday|24h|7d|30d|90d|6mo|12mo|all|custom` + `from/to` epoch ms), `tz` (IANA, from
the browser), `filters: Array<{ dim, op: is|isNot|contains, value }>` over
`path|entryPath|exitPath|host|referrer|channel|utmSource|utmMedium|utmCampaign|utmTerm|utmContent|country|device|browser|os|language|event`,
`compare: boolean`.

| procedure | returns |
|---|---|
| `site.get` / `site.ensure` / `site.update` / `site.rotateKey` | site row, snippet, allowed hosts, `firstEventAt`, rejected counter |
| `overview` | `totals` (visitors, pageviews, sessions, bounceRate, avgDurationMs, viewsPerVisit, conversions), `previous` (same shape, when `compare`), `series[{t, visitors, pageviews, sessions}]`, `bucket: hour|day|week|month`, `liveVisitors` |
| `breakdown` | `{ dimension, rows[{key, visitors, pageviews?, bounceRate?, avgDurationMs?, conversions?, share}], total, hasMore }` for the dimension list above + `channel`, `screen`; `limit/offset` for "See all" |
| `realtime` | `{ liveVisitors, byPath[], online[{visitor, path, country, browser, os, device, lastSeenAt}], recent[…last 24 h sessions…] }` |
| `visitor` | one visitor's sessions + events for the current UTC day (trail) |
| `events.list/update/archive` | definitions with counts in range |
| `funnels.list/create/update/archive/compute` | Phase 3 |

Timezone-correct buckets: `date_trunc(unit, ts AT TIME ZONE $tz)`. Bucket rule: ≤ 2 days → hour,
≤ 92 days → day, ≤ 400 → week, else month. Series are zero-filled up to "now", never into the
future. Channels (Direct, Organic Search, Organic Social, Referral, Email, Paid Search, Paid Social,
Display, Affiliate, Video) are classified in SQL from `referrer_host` + `utm_medium/source` via a
generated CASE from `@otterdeploy/shared/channels`.

## 7. Web IA (`/$orgSlug/analytics`)

One page, search-param views (`servers.tsx` idiom): **Overview · Realtime · Traffic · Events ·
Funnels · Setup**. Header: `PageHeader` + scope selector (install/org/project) + range picker
(presets + calendar) + filter bar (chips; rows in every breakdown card add a filter) + live
badge. All state in the URL. Overview: 5 stat tiles with period deltas (click a tile to switch the
hero metric), hero `TimeSeriesChart` (visitors on the accent, pageviews on `--chart-2`, previous
period dashed), then a 3-column grid of breakdown cards, each with a dimension switcher and
"See all" dialog: Pages (pages/entry/exit) · Sources (channels/referrers/UTM) · Locations
(map + countries) · Devices (browser/OS/device/screen) · Goals (conversions with rate) ·
Realtime. Quiet Instrument throughout: hairline rings, mono for paths/hosts/counts, no shadows,
grey for single series, accent ≤ 10 % of chrome.

## 8. Privacy

Cookieless; no fingerprint persisted; daily-rotating salted hash; IP never stored; UA reduced to
families; query strings dropped except UTM; `identify` ids hashed; GPC honoured server- and
client-side; per-site `require_consent` gate; `exclude_paths` globs; secret-shaped prop keys
(`token`, `password`, `secret`, `email`, `authorization`) dropped at collect.

## 9. Out of scope for now

Revenue providers (owner deferred), ClickHouse, session replay/heatmaps, imports, MCP/AI chat,
weekly digest (Phase 4), public share links (Phase 4).
