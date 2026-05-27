# Cloudflare Domain Connect — SaaS-as-Relay

Status: **not started**. Prereqs (ops + Cloudflare approval) gate the work.
This doc is the implementation plan; pick it up when prereqs land.

## What we're building

A one-click flow for connecting an org's base domain to Cloudflare DNS:

```
[ otterstack settings ]
   user clicks "Connect via Cloudflare"
        │
        ▼
[ self-hosted install ]  ── POST /api/relay/start ──▶  [ otterstack.dev (SaaS relay) ]
                                                          signs a Domain Connect apply URL
                                                          stores { state, callbackUrl } briefly (≤10 min)
                                                          returns apply URL
        ◀────────── apply URL ──────────────────────
   open URL in new tab
        │
        ▼
[ dash.cloudflare.com Domain Connect UI ]
   "otterstack wants to add these records to acme.com — Confirm?"
   user confirms
        │
        ▼  redirect_uri = app.otterstack.dev/api/relay/cb?state=…
[ otterstack.dev (relay) ]
   decrypts state → bounces 302 to <callbackUrl>?cloudflare=ok
        │
        ▼
[ self-hosted install ]
   /settings?cloudflare=ok
   marks domain verified, refetches org.settings
```

Both ends of the relay are otterstack code — same monorepo. The SaaS install
(`otterstack.dev`) runs with `OTTERSTACK_ROLE=relay`; the self-hosted install
runs without that flag and points `OTTERSTACK_SAAS_RELAY_URL` at the SaaS host
(default `https://app.otterstack.dev`).

When the SaaS isn't reachable, the UI silently falls back to the paste-token
flow that's already shipped — no broken state.

## Why the relay, not direct integration per install

Each self-hosted install can't register its own Domain Connect template:
Cloudflare approves templates per-org via a manual GitHub PR + email review.
Hundreds of `otterstack-john.base-domain.json` PRs would get closed. So the
SaaS install owns the template (and the signing key) and signs apply URLs on
behalf of any self-hosted install that opts in.

Trade-offs we accept by going this way:
- Self-hosted installs depend on `otterstack.dev` being up for the one-click
  path to work. Paste-token fallback covers outages.
- The SaaS relay sees which domains every install is connecting. We don't
  log the domain in the relay's request store; the relay only needs it
  ephemerally to sign the URL.

Self-hosters who want to avoid the relay entirely can still register their
own Domain Connect template (same steps the SaaS took) and point the
self-hosted install at their own relay. The env var makes this swap-in clean.

## Prereqs (ops side, do these BEFORE code)

| # | What | Owner | Blocking |
|---|------|-------|----------|
| 1 | Deploy `app.otterstack.dev` (SaaS) | platform team | yes — relay has to live somewhere |
| 2 | Generate RSA-2048 keypair for Domain Connect signing | platform team | yes — Cloudflare rejects unsigned URLs |
| 3 | Publish public key as TXT record `_dck1.otterstack.dev` | platform team | yes — Cloudflare DNS-resolves this to verify signatures |
| 4 | Store private key in SaaS secret manager (env var or Vault) | platform team | yes |
| 5 | Write template JSON (`otterstack.base-domain.json`) | platform team | yes — defines which records get added |
| 6 | PR template to [Domain-Connect/Templates](https://github.com/Domain-Connect/Templates) | platform team | yes — Cloudflare pulls from this repo |
| 7 | Email `domain-connect@cloudflare.com` with template link + `syncPubKeyDomain` + SVG logo + proxy preferences | platform team | yes — multi-day async, blocks everything below |
| 8 | Wait for Cloudflare approval | Cloudflare | yes |

Template JSON skeleton (to be saved as
`otterstack.base-domain.json` in the Templates repo):

```json
{
  "providerId":   "otterstack",
  "providerName": "otterstack",
  "serviceId":    "base-domain",
  "serviceName":  "otterstack base domain",
  "version":      1,
  "syncBlock":    false,
  "syncPubKeyDomain": "otterstack.dev",
  "logoUrl":      "https://app.otterstack.dev/static/logo.svg",
  "description":  "Connect your domain to otterstack — points the apex at your server and adds the verification TXT.",
  "records": [
    {
      "type":  "TXT",
      "host":  "_otterstack-verify.@",
      "data":  "%verifyToken%",
      "ttl":   300
    },
    {
      "type":  "A",
      "host":  "@",
      "pointsTo": "%serverIp%",
      "ttl":   300
    },
    {
      "type":  "CNAME",
      "host":  "*.apps",
      "pointsTo": "@",
      "ttl":   300
    },
    {
      "type":  "CNAME",
      "host":  "*.db",
      "pointsTo": "@",
      "ttl":   300
    }
  ]
}
```

The `*.apps` and `*.db` wildcards cover every future service/database the user
creates without needing per-resource DNS edits later.

## Code plan (do this AFTER prereqs land)

Six discrete changes, in dependency order.

### 1. SaaS relay endpoint — `POST /api/relay/cloudflare/start`

New router slice at `packages/api/src/routers/relay/`. Available only when
`OTTERSTACK_ROLE=relay` is set.

Input:
- `domain`        (the customer's apex)
- `verifyToken`   (TXT challenge value the install already generated)
- `serverIp`      (where the A record should point)
- `callbackUrl`   (where to bounce the user after Cloudflare confirms;
                   restricted via allowlist — see security below)

Behavior:
1. Discover the customer's DNS provider via `dig TXT _domainconnect.<domain>`.
   If not `domainconnect.cloudflare.com`, return `415 Unsupported`
   (customer's DNS isn't Cloudflare; client falls back to paste-token).
2. Build the apply URL with template variables filled in.
3. Generate a 10-minute state token: `state = base64url(rand(16))`.
4. Store `{ state → callbackUrl, expiresAt }` in a short-lived KV (Redis
   or Postgres with a TTL sweep). Never store the domain.
5. Sign the apply URL: `sig = base64url(RSA-SHA256(private_key, normalized_query))`.
   See Domain Connect spec §6 for the canonicalization rules — order matters.
6. Return `{ applyUrl }` to the caller.

### 2. SaaS relay callback — `GET /api/relay/cloudflare/cb`

Cloudflare redirects users here after they confirm.

Query: `?state=<token>&success=<true|false>`

Behavior:
1. Look up `state` in the KV. If missing/expired, render a generic
   "Session expired, try again from your otterstack instance" page.
2. Pull `callbackUrl` out of the KV. Delete the entry (single-use).
3. 302 to `<callbackUrl>?cloudflare=<ok|denied>`.

### 3. Self-hosted client — `lib/cloudflare-relay.ts`

Thin client that POSTs to the relay. Reads `OTTERSTACK_SAAS_RELAY_URL`
(default `https://app.otterstack.dev`). When unset or the request fails,
the existing paste-token UI is the fallback path — no relay code throws.

### 4. Self-hosted callback handler

Wire up `/api/cloudflare/callback?cloudflare=ok` in the web app (or as
an oRPC endpoint). On `ok`:
1. Re-run the existing TXT verify (Cloudflare's records are live by now).
2. Mark `org.baseDomainVerifiedAt`.
3. Redirect to `/settings`.

On `denied`: surface a toast, leave the org unverified.

### 5. UI — Settings page

The Cloudflare card grows a primary button:

```
[ Connect via Cloudflare (one-click) ]    ← shown only when discovery
                                            returns cloudflare.com
[ Add records manually ▼ ]                ← collapsible: paste-token path
```

When the relay is unreachable or the customer's DNS isn't Cloudflare,
hide the one-click button entirely and present the paste-token path as
the primary.

### 6. Discovery cache

`_domainconnect.<domain>` lookups can be slow. Cache in Postgres
(per-domain, 1-hour TTL) so the Settings page renders without waiting
on DNS on every load.

## Security considerations

| Concern | Mitigation |
|---------|------------|
| Open-redirect via attacker-supplied `callbackUrl` | Allowlist scheme=https + suffix-match against a configurable list of self-hosted otterstack origins. For dev, allow `http://localhost:*`. |
| Replay of signed apply URL | Apply URLs include `state` (single-use) and a short `iat` claim. Cloudflare rejects requests older than 10 minutes anyway per spec. |
| Private key exposure | Private key never leaves the SaaS process. Stored in env var or secrets manager. Never logged. |
| SaaS sees customer domains | We don't log `domain` in the KV (only the state token + callbackUrl). The signed URL passes through memory only. |
| Self-hosted install impersonates another install | Self-hosted installs don't authenticate — they just supply a callbackUrl. The attack is "make user click connect and redirect them to someone else's install" — which requires also getting the user to confirm on Cloudflare's UI; user sees the records being added to their own domain. Low-impact. We can add HMAC auth later if abuse appears. |

## Testing strategy

- **Unit:** sign/verify roundtrip against a fixed keypair fixture; discovery
  TXT parser; state-token TTL.
- **Integration:** mock Cloudflare DNS lookups; assert the apply URL string
  matches a snapshot for known inputs.
- **Local dev:** override `OTTERSTACK_SAAS_RELAY_URL=http://localhost:3001`
  and run a second instance of otterstack with `OTTERSTACK_ROLE=relay`.
  Use a test Cloudflare zone; verify the full flow once.
- **Production smoke:** end-to-end test after Cloudflare approval lands.
  Test domain on the SaaS team's own Cloudflare account.

## Out of scope (for now)

- Other DNS providers that implement Domain Connect (GoDaddy / IONOS / Hover).
  Same protocol, different `urlSyncUX`. Adding them post-launch is a config
  change, not a code change — the discovery step already returns whatever
  provider the domain's TXT points at.
- Async Domain Connect flow (OAuth-style with refresh tokens). The sync
  flow we're using is sufficient for one-shot record creation; async is
  needed only for ongoing record management which we don't do.
- Per-self-hosted-install template registration. Mentioned in the README
  as a path for users who want to avoid the SaaS relay, but we don't ship
  tooling for it.

## Effort estimate

- Ops prereqs: **2–4 hours** of work spread over 1–3 weeks (Cloudflare
  approval is the long pole).
- Code: **~half a day** after prereqs land. Most of the surface is
  small: one relay endpoint, one callback, one client, UI wiring.
- Total elapsed: **2–4 weeks** including approval wait.

## Decision log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-27 | Use Domain Connect, not OAuth or scraped flows | Open spec, Cloudflare-supported, what Vercel does |
| 2026-05-27 | SaaS-as-relay over per-install templates | Cloudflare won't approve N templates from M self-hosters |
| 2026-05-27 | Paste-token stays as the fallback, never removed | Covers non-Cloudflare DNS providers + relay outages |
| 2026-05-27 | Defer code until prereqs land | Code is dead weight without an approved template |
