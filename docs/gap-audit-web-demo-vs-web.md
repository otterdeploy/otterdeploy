# Gap Audit — `apps/web-demo` (design target) vs `apps/web` (implementation)

Date: 2026-07-09. Method: six parallel deep-read audits, every demo screen read in full and
compared file-by-file against its real-app counterpart. Tags: **[MISSING]** designed in the demo,
absent in the app · **[DIVERGENT]** exists but differs · **[EXTRA]** app exceeds the demo ·
**[STUB]** rendered control with no behavior.

**Orientation.** The demo contains two generations: (A) the canonical styled prototype under
`apps/web-demo/src/features/otterdeploy/` (mock `data.ts`, ~30 full screens), and (B) an earlier
plan-based scaffold (`project-canvas/`, `resource-drawer/`, `workspace-*/`). The real app
superseded (B) almost entirely and implemented much of (A) — often deeper — but whole surfaces
from (A) never landed. Where the real app deviates it is frequently *better* (honest states, real
data, richer flows); the gap is concentrated in **breadth** (missing pages) and **brand/visual
affordances** (logos, color signals, safety patterns).

---

## 1. Executive summary

### Entire surfaces designed in the demo with no real counterpart

| Surface | Demo file | Severity |
|---|---|---|
| **Webhooks** (outbound + delivery log + inbound trigger endpoints) | `screens/webhooks.tsx` (1,154 lines) | high |
| **Templates gallery** + template deploy flow | `screens/templates.tsx` | high |
| **Volumes** page + all volume lifecycle (snapshot/resize/detach/delete) | `screens/volumes.tsx` | high |
| **Databases catalog** (org-wide inventory with health stats) | `screens/databases.tsx` | high |
| **Certificate management** (PEM upload, CA store, renew/revoke) | `screens/certificates.tsx` | high |
| **Account/security settings** (profile, 2FA mgmt, sessions+revoke, personal tokens) | `screens/settings.tsx` Account tab | high |
| **Danger zones** (workspace/project delete+transfer, type-to-confirm pattern) | `settings.tsx`, `settings-page.tsx`, `cluster-settings.tsx` | high |
| **Cluster settings** panes (Raft/quorum, image cache, log retention, security policy/SSO, telemetry, maintenance) | `screens/cluster-settings.tsx` | high (security/retention), med (rest) |
| **Scaling controls for existing services** (replicas, cpu/mem, autoscale post-create) | `service-detail.tsx` Scaling tab | high |
| Project-wide **deployments list** | `screens/deployments.tsx` | med |
| **Monitoring** dashboard & **Swarm** page | `workspace-ops/overview-pages.tsx` | med |
| Project **Overview** page (deliberately deleted — graph is the overview) | `screens/overview.tsx` | med, deliberate |

### The user-flagged logo problem — confirmed

The **registries** feature never uses brand logos even though the SVGs already exist:
- Cards show a generic `Database02Icon` (`apps/web/src/features/registries/registry-card.tsx:58-64`).
- The add dialog uses plain-text host chips (`registry-fields.tsx:48-67`) instead of the demo's
  4-column logo grid of 8 registry kinds with per-kind URL/auth defaults
  (`web-demo .../screens/registries.tsx:313-517`).
- Docker/GitHub/AWS/Google Cloud/Azure marks are all present in
  `apps/web/src/shared/components/ui/svgs/` and resolvable via `SvglLogo` — **low-effort,
  high-visibility fix**.

Related brand debt:
- Real `SvglLogo`/`DatabaseLogo` dropped the demo's **theme-aware light/dark pairs**; concretely
  broken: `github.tsx` hardcodes `fill="#1b1f23"` and `mongodb.tsx` `fill="#001E2B"` — near-invisible
  on the `#0c0c0b` dark canvas.
- No wordmark SVGs (9 variants in demo, unused there too — staged assets).
- No PagerDuty/Firebase/Gitea/Bitbucket marks anywhere (letter monograms in both apps).

### Honesty violations in the real app (fake data / dead controls)

These contradict PRODUCT.md's "honest-about-system-state" and DESIGN.md's no-fake-data rule:

1. **Header search input is dead** — looks live, has a "K" kbd hint, no handler
   (`features/shell/components/site-header.tsx:46-61`). Palette opens only via ⌘K / user menu.
2. **Variables Sync tab shows fake connected providers** — hardcoded "connected · 17 secrets · 2m
   ago"; connect/disconnect mutate local state only (`$projectSlug/variables.tsx`, header comment
   admits Plan 7 follow-up).
3. **Sidebar footer hardcodes "sf-bay / rack-2", `v1.4.2-rc.1`**
   (`sidebar/project-sidebar.tsx:111-115,188-199`).
4. **New-resource StepStorage toggles are decorative** — "Auto-grow volume", "Encrypt at rest",
   backup-window select are local `useState`, never written to the form
   (`new-resource/steps/storage.tsx:100-118`, `form-primitives.tsx:55-74`).
5. **Servers availability select is a no-op** ("wire to `server.setAvailability` once it lands",
   `-components/servers-row.tsx:369-374`).
6. **Download .env button has no handler** (`-components/variables-table.tsx:492-494`).

### Quick wins (small diffs, visible payoff)

1. Wire SiteHeader search → `setCommandPaletteOpen(true)` (or swap to a button like the demo's).
2. Registries: brand logos on cards + a kind picker in the dialog (assets already exist).
3. Theme-aware GitHub/AWS/MySQL/MongoDB icons (port the demo's dark/light pairs or use currentColor).
4. Env-picker **status dots** (prod/staging color signal) in `HeaderNav` — demo designs it twice.
5. Real region/version in the sidebar footer; remove or wire the dead controls above.
6. API keys: "I have stored this token securely" gate on the reveal dialog; rotate action.
7. Edge-logs latency mini-bar + cache HIT/MISS tinting (tiny row polish).

---

## 2. Integrations — registries, git providers, webhooks, notifications, certificates

### Registries (`screens/registries.tsx` → `features/registries/`)
Demo: logo cards with status/auth badges, image counts, last-pulled, Test connection, Refresh tags;
image pull-cache panel (disk/hit-rate/clear); add modal = 8-kind logo grid → pre-filled URL + auth
defaults, 5 auth modes (basic/token/IAM role/cloud-metadata/anonymous), Test & save.
Real: generic-icon cards, flat form (name/host/user/password only), host locked on edit, delete with
FK warning; has empty state/skeleton/optimistic writes (demo has none).
- [MISSING high] provider logos + registry-kind picker (user-flagged)
- [MISSING med] Test connection; non-password auth modes; card stats (images/last-pulled/cert-expiry warn)
- [MISSING low] pull-cache panel
- [DIVERGENT med] framing: demo = *pull* credentials for services; real = *push* credentials for the builder

### Git providers (`screens/git-providers.tsx` → `features/git-providers/`)
Real is GitHub-only via GitHub-App manifest flow; gitlab/gitea/bitbucket are "coming soon" cards.
Logos ARE used here (only integration surface that does).
- [MISSING med] GitLab/Gitea/Bitbucket connections (demo designs self-hosted URL + PAT + scopes)
- [DIVERGENT med] auth model: demo OAuth/PAT + scope checkboxes + surfaced webhook secret vs real App-manifest
- [DIVERGENT low] card stats missing webhook count + last-sync
- [EXTRA] detail pages (General/Permissions/Resources tabs), per-installation mgmt, reinstall flow
- Cleanup: `git-providers.$providerId.tsx` is a near-duplicate of `github-app.$providerId.tsx`; only the latter is linked.

### Webhooks (`screens/webhooks.tsx` → **nothing**)
- [MISSING high] entire page: outbound webhooks (9 platform events, HMAC secret reveal/copy, test,
  pause, retry policy), recent-deliveries table (status/attempt/latency), inbound trigger endpoints
  (unique URL, HMAC, IP allowlist, redeploy/script/notify actions, curl-snippet success screen).
  Only overlap: the notifications "webhook" channel (event routing, not management).

### Notifications (`screens/notifications.tsx` → `features/notifications/`) — **shipped to design**
Real matches or exceeds: live collections, 14 events (demo 12), Resend/SMTP choice, push/FCM kind,
edit-locking, validation, empty states.
- [MISSING low] PagerDuty + Firebase logos (monogram fallback); in-dialog "Send test"
- [DIVERGENT trivial] Postmark → Resend copy

### Certificates (`screens/certificates.tsx` → `networking/certificates-tab.tsx` only)
Real is a per-project read-only live-probe table (good honesty, small surface).
- [MISSING high] custom cert upload (PEM chain+key) + replace/delete; trusted-CA store (upload/view/remove)
- [MISSING med] org-wide cert inventory + stat cards; renew/renew-all/revoke; issuance logs
- [EXTRA] live TLS probing, self-signed/unreachable detection, expandable detail rows

---

## 3. Workspace settings & security

The demo designs a **unified settings page** (14 anchored sections, grouped sticky rail, scroll-spy
TOC — `workspace-settings/`) and an OS-style tabbed variant. The real app scatters equivalents
across flat routes (Settings/Instance/Platform/Team/…) with no rail, no TOC, no anchors.
- [DIVERGENT high] settings IA (unified rail vs scattered flat routes)
- [MISSING high] user security surface: sessions list + revoke, 2FA/passkey management UI, personal
  token (copy/rotate + CLI hint), profile — none exist (nav-user only signs out)
- [MISSING high] danger zones everywhere: workspace delete/rotate-credentials/pause-ingress; project
  transfer + type-to-confirm delete (real project settings is domain-only); the **type-the-phrase
  confirm modal pattern is entirely absent** (real uses plain AlertDialog / `window.confirm`)
- [MISSING high] platform security policy: OIDC SSO, require-MFA, session/idle timeouts, CIDR
  allowlist, TLS/HSTS toggles (`cluster-settings.tsx:586-692`)
- [MISSING high] log/audit retention controls (per-stream retention, S3 archival, sampling)
- [MISSING med] cluster identity (name/region/timezone), Raft/quorum manager table + promote/demote,
  image-cache pane, backups defaults pane, maintenance pane (system check, export config)
- [MISSING med] roles & permissions capability matrix; integrations grid (Slack/Sentry/Datadog/PagerDuty)
- [MISSING med] summary KPI row on settings
- [EXTRA] real app's strongest settings content has no demo counterpart: domain verification + Cloudflare
  auto-configure, control-plane domain, email transport + test-send, self-updater (≈ demo's version card,
  minus changelog link)

### API tokens (`screens/api-tokens.tsx` → `features/api-keys/`)
- [MISSING med] rotate; last-used IP+geo; per-token 24h usage sparklines; stored-securely checkbox
  gate on reveal
- [DIVERGENT med] scope model: demo 10 verb-scopes × 7 groups with severity coloring vs real 5
  resources, neutral badges, **enforcement is advisory** (`shared.ts:13-15`)
- [DIVERGENT low] revoke (terminal) vs enable-switch (reversible); naming drift "API tokens"
  (sidebar) vs "API keys" (page)
- [EXTRA] role gating, optimistic mutations, skeleton/empty states

### SSH keys — **near 1:1 parity** (closest match in the audit)
- [MISSING low] "Add to GitHub" post-generate action; in-modal public-key reveal (real closes dialog)
- [EXTRA] confirm dialogs, imported-keys-can't-rotate rule, role gating

### Audit (`screens/audit.tsx` → `$orgSlug/audit.tsx`)
Real is architecturally stronger (live collections, server pagination, denied-vs-failed, CSV,
duration column) but filter-poorer and visually flatter.
- [MISSING med] actor / action-type / resource-kind filter dropdowns; anomaly surface (tile, tinted
  rows, drawer narrative)
- [MISSING low] action-color dots, resource kind icons + project chips, geo/session/HTTP-status in
  drawer, parent/correlated events as navigable cards, custom date range

---

## 4. Data plane — databases, data viewer, backups, volumes

### Databases catalog (`screens/databases.tsx` → **no page**)
DBs are reachable only as graph nodes → resource panel (which covers console/browse/settings well).
- [MISSING high] org-wide catalog (cards, project filter, "Add database")
- [MISSING med] DB health stats: storage used/total bar, connections, QPS, backup freshness — no
  storage or engine-level stats exist anywhere (metrics are container cpu/mem/net only)
- [MISSING med] backups affordance on the DB itself (panel's "Take backup / Snapshot now" is
  intentionally disabled and doesn't link to the Backups page)
- [MISSING low] one-click connection-string copy on a card surface

### Data viewer (`screens/data-viewer.tsx` → postgres data studio) — substantial in both, different shapes
Real exceeds demo on: FK jump popovers, ⌘K spotlight, snippet folders, resizable panes, capability
envelope, native Redis/Mongo/MariaDB browsers, honest unsupported-engine fallback.
- [MISSING med] Structure view (PK/FK/UQ + defaults detail); Add-record modal; **staged-writes
  pending bar** (real cell edits commit immediately); audit/timeout header badges + brand logo in
  the connection header
- [DIVERGENT med] destructive confirm: demo typed-name modal vs real `window.confirm`
  (`use-data-studio.ts:158`) — weakest safety divergence
- [MISSING low] column show/hide, JSON/XLSX + export-selected, multi-select bulk delete, row detail
  panel, query history, settings popover, per-table row counts, numeric filter ops

### Backups (`screens/backups.tsx` → `features/backups/`) — **closest full-page match**
Page composition mirrors demo 1:1 on live data; real adds destination editor + credential Test,
schedule delete, multi-destination, max-age/max-storage caps.
- [MISSING med] restore-as-new (explicitly deferred); volume+stack backup **sources** (contract enum
  has them; filter chips can never match — dead UI)
- [MISSING low] restore Verify step (checksum diff), schedule notification channel, PITR editor
  field (card renders a badge the editor can't set)
- [DIVERGENT low] stat tiles less informative (glyphs vs relative-time + error excerpt); no per-row
  delete (deliberate, retention-only); blob download vs presigned URL

### Volumes (`screens/volumes.tsx` → **nothing**)
- [MISSING high] entire page (inventory, usage bars, drivers, attach state) and all lifecycle
  (create standalone, snapshot, resize, detach, delete) — volumes exist only implicitly with a DB
- [MISSING med] snapshot schedules; per-volume usage measurement anywhere
- [DIVERGENT med] StepStorage's decorative toggles (see honesty list)

---

## 5. Observability — logs, edge logs, metrics, deployments, docker

**Real app largely surpasses the demo here** (virtualized log table, histogram drag-filter, URL
state, edge-logs threat flagging + Block IP + Country, the entire Firewall + Events planes,
deployment phase timeline + rollback + live log streams).

Remaining gaps:
- **Docker raw** — biggest interaction gap in the domain:
  - [MISSING high] per-row actions: container Logs/Inspect/Exec; image Pull/Inspect/Remove;
    volume/network Inspect/Remove (real tables fully read-only)
  - [MISSING med] node selector + node column (demo scopes every tab by swarm node)
  - [MISSING low] container ID/Command/Ports columns, network Subnet/Gateway, task Age/Image;
    restarting/paused badge tones
- [MISSING med] project-wide deployments list route (demo designs it twice; per-resource only today)
- [MISSING med] metrics: no project-aggregate charts; no request-rate/p95 charts anywhere (no HTTP
  metrics pipeline)
- [DIVERGENT low] deployment history rows lead with image ref instead of commit sha/message/author;
  rollback hidden in kebab + `window.confirm` vs demo hover button
- [MISSING low] edge-logs polish: latency mini-bar, short-UA column, cache HIT/MISS tint, upstream
  latency; logs: no lookback past the 30m live buffer, no structured query syntax; metrics: no 7d
  range, colored recharts vs demo monochrome ink

---

## 6. Project & service surfaces

**Real app is deepest here** — pending-changes manifest model (ghost/comet nodes, staged panels,
diff bar), dagre layout persistence, compose group nodes, PR-preview satellites, custom domains +
DNS verify, deployment protection, deploy hooks, repo inspection + monorepo picker, live cert
probing. Gaps:

- [MISSING high] **templates** (whole surface — gallery, filters, detail modal with architecture
  diagram, deploy flow; wizard card is honestly "soon")
- [MISSING high] **scaling for existing services** — no replicas/cpu/mem/autoscale controls
  post-create (wizard Resources step is create-time only; Identity card read-only); demo's
  node-placement viz + autoscaling form have no counterpart
- [MISSING med] graph **traffic visualization** (animated particles, edge width ∝ RPS, hover labels,
  live traffic/p95 chip); legend; explicit re-layout action
- [MISSING med] stack panel **Activity** and **Traffic** tabs ("coming soon" placeholders); drawer
  drag-resize + persisted height
- [MISSING med] service panel Overview sub-tab (stat tiles + nav cards + per-service activity),
  service Logs tab, scoped Networking sub-tab (container-port editor, health-check path/interval,
  XFF/WebSocket/compression toggles)
- [MISSING med] wizard: GitLab/Gitea/**CLI-push** sources; image step registry logo cards +
  available-tags browser + watch-tag/cosign update strategy
- [MISSING med] networking: per-route editor modal (hostnames, rate limit, per-route toggles);
  demo's editable Caddyfile + snippet buttons became a read-only viewer + custom-config escape
  hatch (deliberate — reconciler-owned)
- [MISSING/STUB med] servers: availability select no-op; no reboot/promote/remove or SSH tab in the
  health sheet; no region column, project pinning, or label editing
- [MISSING low] health-check config, pause service, rename/description, "degraded"/"rolled-back"
  status expressions; single shared StatusBadge (three parallel vocabularies today)
- [DIVERGENT med] variables Sync tab = fake data (see honesty list); bulk-edit is single-env only;
  no drag-drop .env import; no per-row tag/pin/history/reference actions
- Projects list: implemented ~1:1 incl. MiniCanvasPreview; real adds running/total counts. ✅

---

## 7. Shell, chrome, brand, tokens, auth

- [DIVERGENT high] shell topology: demo's dual icon rails (workspace + project) + 40px breadcrumb
  bar vs real grouped shadcn sidebar (default-collapsed) + header + project tab row; demo's
  always-visible workspace rail inside a project is lost
- [MISSING high] dead header search (honesty list #1)
- [MISSING med] notifications bell in header; per-settings-page anchor rail; env status dots;
  Monitoring/Swarm destinations (renamed/absorbed: Requests→Edge logs, Routing→Networking,
  Activity→Audit, Members→Team, Swarm→Servers, Monitoring→Platform)
- [MISSING med] theme-aware brand icon pairs (GitHub/MongoDB invisible in dark — see §1)
- [MISSING low] command palette per-service "Tail logs" + Rollback actions; org-switcher role badges
  + "New workspace"; terminal kind-glyph tabs (sh/pg/rd chips), connection dot, project-tag dots;
  user-menu "Invite team"/"Docs" shortcuts
- [DIVERGENT low] auth: real far exceeds demo (split-screen AuthLayout, 2FA challenge, social,
  device pairing) — but headline uses `clamp()` (DESIGN.md Fixed-Scale Rule violation), and
  `/device` + `/accept-invite` render bare cards without the AuthLayout treatment
- **Tokens verdict:** real `index.css` is **closer to DESIGN.md than either demo stylesheet**
  (correct OKLCH accent, greyscale chart ramp, self-hosted Geist, font features). Demo's own
  `index.css` (amber brand) is superseded drift. Minor: no density switch, no shadow token
  vocabulary, `--destructive-foreground === --destructive` oddity.
- Cleanup: dead shell scaffold files (`nav/main.tsx`, `nav/secondary.tsx`, `nav/projects.tsx`,
  `search-form.tsx`, `sidebar/environment-selector.tsx`); duplicate git-provider detail route.

---

## 8. Where the real app surpasses the demo (do not regress)

Pending-changes manifest lifecycle (bar, diff, ghost/comet nodes, staged panels) · dagre layout with
persistence + drag anti-flicker · compose stack groups · PR-preview satellites · deployment detail
(phase timeline, live build/deploy logs with error navigators, rollback) · custom domains with DNS
verification · deployment protection/access · deploy hooks · repo inspection + monorepo folder
picker + fast-path wizard · data studio (FK jumps, spotlight, snippet folders, Redis/Mongo/MariaDB
browsers) · backups destination editor + credential Test + GFS caps · live server health · edge-logs
threat flagging, Block IP, Country, Events plane · entire Firewall feature · team management ·
auth system (2FA, social, device flow) · honest skeleton/empty/error states throughout · i18n ·
DESIGN.md-correct tokens.

---

## 9. Suggested build order

1. **Quick wins** (§1): header search, registry logos + kind picker, theme-aware icons, env dots,
   real sidebar footer, kill/wire dead controls.
2. **Webhooks page** — largest missing surface with clear demo blueprint.
3. **Safety patterns**: type-to-confirm destructive modal component; replace `window.confirm`
   (data-studio writes, rollback); danger zones for project/workspace.
4. **Account/security settings** (sessions, 2FA UI, personal tokens) — backend (better-auth)
   already supports most of it.
5. **Scaling controls** for existing services.
6. **Templates gallery**; **volumes page**; **databases catalog** (or fold health stats into graph
   panels first).
7. **Docker raw actions + node scoping**; project-wide deployments list; certificates management;
   settings IA consolidation (unified rail); cluster-settings panes (security/retention first).
