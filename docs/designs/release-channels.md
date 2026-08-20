# Release channels: stable + nightly

Status: implemented (2026-08-19). Tracked as od-tfs2. Shipped surface:
`.github/workflows/nightly.yml` (the cutter), the retag path in
`images.yml`, the stable-only gate in `cli-publish.yml`, the channel-aware
`release-source.ts`, and the channel picker in the Updates card.

## Why

Today the in-app updater tracks exactly one stream: GitHub `releases/latest`
(release-source.ts). Every user gets the same cadence. We want users to pick:

- **stable** — curated releases, the default, what production installs run.
- **nightly** — continuously released from main, for users who opt into
  testing changes early (and for us to soak features before promoting them).

## How the industry does it

Surveyed 2026-08-19; the three closest references converge on the same shape.

**Coolify** — a CDN-hosted `versions.json` is the single version authority,
with top-level channels: `v4` (stable) and `nightly`, each pinning one
version. The instance compares its running version against its channel's
pinned entry. Crucially, the CDN pin is promoted *manually* and often lags
the GitHub release by hours or days — the lag is the stability gate.
(Sources: [versions.json](https://cdn.coollabs.io/coolify/versions.json),
[coolify RELEASE.md](https://github.com/coollabsio/coolify/blob/main/RELEASE.md),
[DeepWiki: Coolify upgrade system](https://deepwiki.com/coollabsio/coolify/2.2-upgrade-system).)

**Dokploy** — channels are moving Docker Hub tags: `latest` (stable),
`canary`, `feature`. The install script pins `DOKPLOY_VERSION=canary|latest`;
canary is built continuously and promoted to main for releases.
(Sources: [Docker Hub tags](https://hub.docker.com/r/dokploy/dokploy/tags),
[install docs](https://docs.dokploy.com/docs/core/installation).)
Weakness worth NOT copying: a raw moving tag means "what version am I
running?" has no stable answer and rollback has no pinned target — their
issue tracker has recurring "`latest` didn't update" confusion
([#3522](https://github.com/Dokploy/dokploy/issues/3522)).

**Home Assistant** — three channels (stable monthly / beta RC-week / dev),
stable explicitly recommended for production; beta exists to catch bugs, not
to preview features. Downgrades across schema versions are unsupported.
(Sources: [release FAQ](https://www.home-assistant.io/faq/release/),
[release schedule](https://www.home-assistant.io/blog/2018/03/24/new-release-schedule/).)

Common denominators:

1. Channel is an **instance-level setting**, switchable in the UI.
2. Stable = **immutable semver tags**. Nightly = continuous builds, but the
   good implementations still give each nightly a **pinned identity**
   (Coolify's manifest entry) rather than deploying a bare moving tag.
3. A **promotion gate** the maintainer controls sits between "CI built it"
   and "instances see it".
4. **No downgrades**: switching nightly→stable waits until stable catches
   up, because DB migrations are forward-only.

## Design for otterdeploy

We already have 90% of the machinery:

- `images.yml` already builds a moving `:latest` on every main push and
  pinned `vX.Y.Z` images (+ GitHub Release) on tag pushes.
- `release-source.ts` resolves the update target from GitHub releases, with
  `OTTERDEPLOY_UPDATE_MANIFEST_URL` as an override.
- `compare.ts` already orders prereleases BEFORE their release
  (`0.16.0-nightly.X < 0.16.0`), and `apply.ts` already refuses downgrades.

So the design is: **nightlies are semver prereleases**, and a channel just
changes which release the source resolves.

### 1. Nightly release cutting (CI)

A scheduled workflow (00:00 UTC) checks whether main moved since the last
nightly tag; if so it tags `v<next-minor>-nightly.<YYYYMMDD>` (e.g.
`v0.16.0-nightly.20260820`) and pushes it. A same-day re-cut (manual
dispatch after the cron, with new commits on main) appends a run counter:
`v0.16.0-nightly.20260820.2`, `.3`, … — each outranks the day's earlier
cuts under semver prerelease ordering. The existing `images.yml` tag
trigger (`v*.*.*`) builds pinned images for it; the release step marks it a
**GitHub prerelease** (prereleases never become `releases/latest`, so stable
instances are structurally unaffected). Each nightly is immutable and
rollback-able — Coolify's pinned-manifest property without the CDN.

`<next-minor>` = latest stable tag with minor+1, patch 0. This makes every
nightly sort AFTER the current stable (users on nightly are ahead) and
BEFORE the next stable (when v0.16.0 ships, nightly users get offered the
stable of the same core — a clean catch-up point).

### 2. Channel setting (server)

`platform_settings.update_channel: "stable" | "nightly"`, default `stable`.
Exposed via the system contract; only instance admins may change it.

### 3. Channel-aware release source

`fetchLatestRelease(channel)`:
- `stable`: `releases/latest` (unchanged — GitHub excludes prereleases).
- `nightly`: `releases?per_page=15`, first entry whose tag parses as a
  version (prerelease or not) — nightly users take stable releases too when
  a stable is newest, which is exactly the catch-up behavior we want.
`OTTERDEPLOY_UPDATE_MANIFEST_URL` keeps working as a full override.

### 4. Guards (mostly already exist)

- Downgrade: `apply.ts` already refuses when target ≤ current; switching
  nightly→stable simply shows "no update" until stable passes the running
  nightly. The channel picker copy says so.
- `compare.ts` orders prerelease identifiers per semver rule 11 (split on
  `.`, numeric identifiers numerically, longer list wins on a tied prefix),
  so dated nightlies order chronologically AND same-day run counters order
  correctly (`….20260820 < ….20260820.2 < ….20260820.10 < ….20260821`).
  Verified shape works with the existing regex (`[0-9A-Za-z.-]+`).

### 5. UI

Channel picker in the update card (Settings → System): stable/nightly radio
with honest copy ("Nightly ships every change from main after CI, may
break, no downgrade path back until the next stable"). Release notes for
nightlies = the generated commit list on the prerelease.

## Out of scope (deliberate)

- A third channel (beta/RC). Add later by cutting `-rc.N` prereleases and a
  three-way picker; the version scheme already supports it.
- Auto-update scheduling per channel (nightly users auto-pull at 04:00).
  Separate feature; works for both channels once built.
- Coolify-style external CDN manifest. GitHub prereleases give us the same
  promotion gate (the nightly cron IS the promotion) without new infra.
