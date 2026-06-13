# Deployment Protection (Vercel-Authentication-style auth wall)

**Status:** Implemented — cross-domain auth wall (forward-auth + handoff + per-domain cookie),
interstitial + denied screens, shareable links + CI bypass tokens, the per-route control surface,
and the orthogonal CrowdSec layer (Caddy bouncer config + xcaddy plugin + Firewall page). CrowdSec
enforcement needs a running CrowdSec agent + bouncer key (operator setup). The per-route
`authPathPrefix` escape hatch (§6) and strict one-time-nonce enforcement (§8) are deferred.

**Last verified:** 2026-06-10

**TL;DR:** A per-deployment toggle that puts a login wall in front of a deployed app, so only
members of the org that owns it can view it — Vercel's "Authenticating… / Vercel Authentication"
feature. Build it **natively** on the existing Caddy edge + Better-Auth org model, **not** Authelia
(see §3 — Authelia can't do transparent cross-domain SSO over arbitrary apps without modifying
them). The hard requirement is **cross-registrable-domain SSO**: projects live on unrelated apexes
(`autodeploy.com`, `plane.com`), and a user logs in **once** and is silently authenticated across
all of them. A shared cookie can't span unrelated apexes, so the design is a tightly-scoped
**mini-OIDC we own**: one central auth authority holds the master Better-Auth session, each
deployment domain gets its own HMAC-signed cookie, bridged by a signed-token redirect handoff. This
is **orthogonal to CrowdSec** (IP-reputation blocking — see `competitor-observability` /
[CrowdSec §10]). Most infrastructure exists: Caddy config generation
(`packages/api/src/caddy/`), the `proxyRoute` table, Better-Auth + the organization plugin, and
`auth.api.getSession`. v1 adds one schema column, three endpoints, one `buildHttpBlock` change, and
a token-signing helper.

---

## Table of contents

1. [Starting point](#1-starting-point)
2. [Mental model](#2-mental-model)
3. [Why native, not Authelia](#3-why-native-not-authelia)
4. [The cross-domain SSO flow](#4-the-cross-domain-sso-flow)
5. [Data model](#5-data-model)
6. [Caddy config changes & the reserved path](#6-caddy-config-changes--the-reserved-path)
7. [API surface (the three endpoints)](#7-api-surface-the-three-endpoints)
8. [Tokens, cookies & revocation](#8-tokens-cookies--revocation)
9. [Hard parts / open decisions](#9-hard-parts--open-decisions)
10. [CrowdSec — the orthogonal layer](#10-crowdsec--the-orthogonal-layer)
11. [Phasing](#11-phasing)
12. [Where this lives in code](#12-where-this-lives-in-code)

---

## 1. Starting point

Today every deployed app is reachable by anyone who knows its URL. The edge is **Caddy**, driven by
generated Caddyfiles pushed through the admin API (`adaptCaddyfile` → `loadCaddyfile` in
`packages/api/src/caddy/client.ts`; `reconcileRoutes` in `reconciler.ts`). Each public route is a
`proxyRoute` row (`packages/db/src/schema/proxy-route.ts`) rendered by `buildHttpBlock`
(`packages/api/src/caddy/builder.ts`) into:

```caddyfile
plane.com {
    reverse_proxy app:3000
}
```

Identity already lives in **Better-Auth** with the **organization plugin** (`packages/auth/src/index.ts`).
A request's session is read with `auth.api.getSession({ headers })` (see `packages/api/src/context.ts`),
and the org that owns a deployment is derivable: `domain → proxyRoute.projectId → project.organizationId
→ member`. So the authorization question is fully answerable from data we already have. What's missing is
a way to *enforce* it at the edge, across arbitrary domains, without touching the deployed app.

## 2. Mental model

Two **independent** layers sit in front of a protected deployment. Conflating them is the most common
mistake (see [CrowdSec §10]):

```
  request
    │
    ▼
 [ CrowdSec ]      "is this IP evil?"          — identity-blind, IP only (optional, §10)
    │
    ▼
 [ auth wall ]     "is this person a member    — reads identity, THIS is the Vercel-style wall
    │               of the owning org?"
    ▼
  the deployed app
```

The auth wall is a Caddy **`forward_auth`** subrequest to a control-plane endpoint. `forward_auth`
proxies a copy of the request (including its `Cookie` header) to the endpoint; **2xx → request
continues to the app; any other status → Caddy relays that response to the browser** (so a `302`
becomes the login redirect for free). The deployed app needs **zero** auth code — the entire point.

## 3. Why native, not Authelia

We evaluated Authelia (forward-auth companion + OIDC provider) and CrowdSec via a verified research
pass. CrowdSec is a clear adopt (§10). Authelia is **not the right tool for this feature** — and the
reason is specific, not hand-waving:

Authelia has two modes, and **neither fits a multi-tenant PaaS protecting arbitrary apps on arbitrary
domains**:

| Authelia mode | Transparent to the app? | Cross-domain SSO? |
|---|---|---|
| **Forward-auth (cookie)** | ✅ no app changes | ❌ cookie spans **one root domain** only |
| **OIDC provider** | ❌ app must be an OIDC **relying party** (client code) | ✅ |

- The **cookie/forward-auth** mode is transparent but can't bridge `autodeploy.com` and `plane.com`
  — the same browser-cookie wall this whole design exists to solve. Authelia's own roadmap
  (`multi-domain-protection`) states its multi-domain support is "sign in to each root domain, no
  inter-domain SSO," with transparent cross-domain SSO "not started" and tied to *future* OIDC RP
  support.
- The **OIDC** mode can do cross-domain, but only because each protected app carries OIDC client
  code. Our deployments are **arbitrary and unmodifiable** — a static site, a user's Rails app. We
  can't add a relying-party SDK to them.

So Authelia forces a choice between *transparent-but-single-domain* and
*cross-domain-but-app-must-change*. We need **both**: transparent **and** cross-domain over apps we
don't control. The only way to get both is to make the **platform's reverse proxy** the relying
party rather than the app — which we can do because **we generate every domain's Caddy config**.
Authelia cannot insert itself as the per-domain relying party for domains whose proxy config it
doesn't own.

Two more nails:

- **Identity duplication.** Org membership lives in Better-Auth. Authelia would mean syncing users
  into a second identity store (YAML/LDAP) and keeping it in sync on every membership change.
- **Competitor precedent.** Vercel, Coolify, and Dokploy all enforce deployment access at *their
  own* proxy over *their own* membership model — none delegate to an external IdP for this.

**Authelia still has a legitimate future use** — a bring-your-own external SSO/2FA/OIDC portal in
front of *internal admin tooling* on a single org domain, where its cross-subdomain SSO and ACL
rules shine. That is a different, lower-priority product and out of scope here.

## 4. The cross-domain SSO flow

**Requirement:** projects live on unrelated registrable domains (`autodeploy.com`, `plane.com`,
`new.example.com`). A user logs in **once** and is authenticated across **all** protected
deployments, regardless of domain. Authorization remains per-domain (member of *that* domain's
owning org).

A shared cookie cannot span unrelated apexes. So:

- **Master session** — the existing Better-Auth session, hosted on **one fixed central auth
  authority** (e.g. `auth.otterdeploy.app`, or the console domain). This is the single sign-on
  source of truth.
- **Per-domain cookie** (`__otter_auth`) — a small **HMAC-signed token** scoped host-only to each
  deployment domain, attesting `{ userId, orgId, domain, exp }`. Not the Better-Auth session; a
  derived proof.
- **Handoff** — a redirect dance that converts the master session into a per-domain cookie.

```
1. Browser → https://plane.com/app
2. Caddy forward_auth → /api/internal/deploy-authz?domain=plane.com
      no __otter_auth cookie  → 302 to the central authority:
      https://auth.otterdeploy.app/.well-known/otterdeploy/authorize
            ?domain=plane.com&return=https://plane.com/app
3. Browser → auth.otterdeploy.app   (master session cookie IS sent here)
      getSession():
        • no session  → /login?redirect=<authorize-url>  → after login, back to authorize
        • has session → member of the org that owns plane.com?
                         (domain → route → project → organizationId → member)
            • yes → mint signed token { userId, orgId, "plane.com", exp≈60s, nonce }
                    302 → https://plane.com/.well-known/otterdeploy/callback?token=…&return=/app
            • no  → 403 (not a member)
4. Browser → https://plane.com/.well-known/otterdeploy/callback?token=…
      (Caddy routes /.well-known/otterdeploy/* to the control plane, NOT the user's app)
      verify token (sig + exp + domain + unused nonce) → Set-Cookie __otter_auth (host-only)
      302 → /app
5. Browser → https://plane.com/app   (now WITH __otter_auth)
      forward_auth → validate signed cookie (sig + exp + domain) → 200 → proxy to app
```

**The SSO payoff:** step 3's master session is shared. When the same user later visits
`autodeploy.com`, the redirect to the authority finds the **existing session → no login prompt →
instant token mint → bounce back**. Log in once; silently authenticated everywhere. A user in org A
gets `autodeploy.com` but `403`s on `plane.com` if not in org B — authentication is shared,
authorization is per-domain.

This is exactly the capability Authelia lacks (§3): transparent (no app code) **and** cross-domain,
achieved by making the platform proxy the relying party.

## 5. Data model

One flag on the existing route table — protection is **per-route** (per-domain), with the
authorizing org derived from the route's project. This matches "multiple projects, multiple
domains."

```ts
// packages/db/src/schema/proxy-route.ts
protected: boolean("protected").notNull().default(false),
// optional escape hatch (§6): per-route override of the reserved auth path prefix
// authPathPrefix: text("auth_path_prefix"),  // default ".well-known/otterdeploy"
```

Plus the matching field on `ProxyRouteInput` (`builder.ts`) and `insertProxyRoute` / `updateProxyRoute`
(`queries.ts`), then `bun db:push`.

No new tables for v1. The handoff token and per-domain cookie are **stateless** (signed, self-
attesting). The only optional state is a short-lived **nonce store** for one-time-use enforcement
(§8) — Redis/BullMQ's existing Redis is the natural home; can be deferred.

## 6. Caddy config changes & the reserved path

`buildHttpBlock` gains two things when `route.protected` is true: a `forward_auth` gate, and an
**ungated** `handle` block for the reserved auth path (so the callback can run *on the deployment
domain* — the only way to `Set-Cookie` for that domain — without being gated by the very wall it's
trying to satisfy).

```caddyfile
plane.com {
    # real ACME cert via the existing usesAcme path (custom-domain verification required)

    handle /.well-known/otterdeploy/* {     # UNGATED — callback + logout land here
        reverse_proxy {$AUTHZ_UPSTREAM}     # control-plane service DNS, e.g. server:3000
    }

    handle {
        forward_auth {$AUTHZ_UPSTREAM} {
            uri /api/internal/deploy-authz?domain=plane.com
            copy_headers Remote-User Remote-Email
        }
        reverse_proxy app:3000
    }
}
```

**The reserved path — why `/.well-known/otterdeploy/`:**

- `.well-known/` is RFC 8615's namespace for site-infrastructure metadata — semantically the right
  home for a platform-injected auth path.
- We intercept **only the scoped subtree** `/.well-known/otterdeploy/*`. The app's *other*
  `.well-known` paths (`acme-challenge`, `security.txt`, `apple-app-site-association`, etc.) fall
  through to the app untouched, because Caddy's `handle` matches the specific prefix and everything
  else hits the catch-all `handle`.
- Collision risk ≈ nil: it only clashes with an app that itself serves `/.well-known/otterdeploy/*`.
  A bare top-level path like `/otterdeploy` is **more** collision-prone (apps own their top-level
  routes), so `.well-known` is the safer choice, not the riskier one.
- **Escape hatch:** make the prefix configurable per route (`authPathPrefix`) for the rare app that
  genuinely needs it. Default `/.well-known/otterdeploy`.

`reconcileRoutes` is unchanged — it already re-renders and reloads on any route change, so flipping
`protected` and re-running reconcile is the apply path.

## 7. API surface (the three endpoints)

All three live on the control plane (Hono, `apps/server/src/index.ts`), following the existing inline
`// ─── … ───` route-section style and the plain-async `getSession` pattern from `context.ts`. No
try/catch (consistent with the `better-result` convention).

**(a) `/.well-known/otterdeploy/authorize`** — on the central authority. Reads the master session,
checks org membership, mints the handoff token.

```ts
// reads master Better-Auth session (cookie present on the central domain)
const session = await auth.api.getSession({ headers });
if (!session) return redirect(`${WEB_URL}/login?redirect=${authorizeUrl}`, 302);

const route = await getProxyRouteByDomain(domain);          // → projectId
const orgId = await getOrgIdForProject(route.projectId);    // project.organizationId
if (!(await isOrgMember(session.user.id, orgId))) return text("forbidden", 403);

const token = signHandoff({ userId: session.user.id, orgId, domain, exp: now + 60, nonce });
return redirect(`https://${domain}/.well-known/otterdeploy/callback?token=${token}&return=${ret}`, 302);
```

**(b) `/.well-known/otterdeploy/callback`** — reachable **on each deployment domain** via the Caddy
`handle` block. Verifies the token, sets the per-domain cookie.

```ts
const claims = verifyHandoff(token);                 // sig + exp + domain-bound + unused nonce
if (!claims || claims.domain !== reqHost) return text("invalid", 400);
setCookie("__otter_auth", signCookie(claims), { domain: undefined /* host-only */, httpOnly: true,
  secure: true, sameSite: "Lax", maxAge: COOKIE_TTL });
return redirect(claims.return ?? "/", 302);
```

**(c) `/api/internal/deploy-authz`** — the `forward_auth` target. Pure signature check, **no DB hit**.

```ts
const route = await getProxyRouteByDomain(domain);
if (!route?.protected) return body(null, 200);       // not gated → allow
const cookie = readCookie("__otter_auth");
const claims = cookie && verifyCookie(cookie);       // sig + exp + domain match
if (!claims) {                                       // missing/expired → start the handoff
  return redirect(`https://${AUTH_AUTHORITY}/.well-known/otterdeploy/authorize`
    + `?domain=${domain}&return=https://${domain}${forwardedUri}`, 302);
}
header("Remote-User", claims.userId);
header("Remote-Email", claims.email);
return body(null, 200);
```

`getOrgIdForProject` / `isOrgMember` are one-line Drizzle selects (`project.organizationId`, then
`member` where `userId + organizationId`) — colocate with `caddy/queries.ts` or a new `authz/`
helper.

## 8. Tokens, cookies & revocation

- **Handoff token** — short-lived (≈60s), HMAC-signed (or JWT) with a platform secret, **bound to
  the target domain**, carrying a **nonce** for one-time use. It rides in the URL, so it's exposed to
  history/referer/logs — short exp + nonce + domain-binding make replay (to another domain or after
  expiry) fail. (OIDC-style `form_post` response mode avoids URL exposure entirely; deferred.)
- **Per-domain cookie `__otter_auth`** — HMAC-signed, host-only, `httpOnly`, `secure`,
  `sameSite=Lax` (must be Lax, not Strict — it has to be sent on the top-level navigation that
  arrives from the auth authority). Self-attesting, so per-request validation is a **pure HMAC check
  with no DB hit** — cheap even when `forward_auth` fires on every asset.
- **Revocation tradeoff** — self-signed cookie ⇒ no per-request DB ⇒ but revocation lags until the
  cookie TTL expires. Pick a TTL that bounds the window (e.g. **1h**); on expiry the next request
  re-runs the handoff, which re-checks live org membership. Removing a member then locks them out of
  deployments within ≤TTL. If instant revocation is ever required, add a per-request membership
  check or a revocation list — explicitly deferred.
- **Secret management** — the signing secret is a platform secret (env). Rotation = support two keys
  during overlap. Out of scope for v1 beyond "use one secret, from env."

## 9. Hard parts / open decisions

1. **Custom-domain verification is a prerequisite.** `forward_auth` + real ACME certs on `plane.com`
   already require the user to prove DNS ownership. Confirm/finish that flow — protection rides on
   it. (Relates to `cloudflare-domain-connect-relay.md`.)
2. **Central auth authority domain** — pick one stable platform domain for the master session +
   `/authorize`. Everything keys off it. Does it need to differ from the console domain?
3. **Reserved path** — default `/.well-known/otterdeploy/*`, configurable per route (§6). Confirm no
   internal platform conflict.
4. **Nonce store** — needed only for strict one-time-use handoff tokens. Use existing Redis, or
   accept short-exp-only for v1 and add the nonce later.
5. **Cookie TTL vs revocation latency** — pick the number (proposed 1h). Product call.
6. **Perf path (later)** — verify `__otter_auth` at the **Caddy edge** with a JWT plugin
   (`caddy-jwt` / `caddy-security`), skipping the control-plane hop entirely on the hot path; only
   redirect-to-authorize on miss. Requires compiling the plugin into `infra/caddy/`. Optimization,
   not v1.
7. **Bypass protection** — the deployed app must be reachable *only* through Caddy (Swarm overlay,
   no published port), or the wall is decorative.
8. **The "Authenticating…" interstitial** (the Vercel loading screen) is cosmetic — a small HTML
   page on the `/login` / authorize round-trip. The `302` chain is functionally sufficient for v1.
9. **Shareable links / bypass tokens** (Vercel parity) — a signed URL that grants access without
   org membership, and an automation-bypass header for CI. Future; the token machinery here extends
   to it cleanly.

## 10. CrowdSec — the orthogonal layer (implemented)

CrowdSec is **not** part of the auth wall and never sees the session — it only answers "is this
**IP** evil?" (it can also scope decisions to ranges/countries/ASNs, and an optional AppSec/WAF
component inspects request *content*, but it is identity-blind throughout). It stacks **before**
`forward_auth`.

Implemented as an opt-in platform layer, enabled by setting `CROWDSEC_LAPI_URL` +
`CROWDSEC_BOUNCER_KEY`:

- **Caddy bouncer plugin** compiled into `infra/caddy/Dockerfile` via `xcaddy`
  (`github.com/hslatman/caddy-crowdsec-bouncer/http`).
- **Caddyfile generation** (`buildCaddyfile`/`buildHttpBlock`): a global `crowdsec { api_url; api_key }`
  app + `order crowdsec first`, and a per-HTTP-site `crowdsec` handler that runs ahead of
  forward_auth and `403`s banned IPs. Threaded through reconcile like the other Caddy options.
- **Firewall page** (`firewall` oRPC router → `apps/web/.../$orgSlug/firewall.tsx`, cluster-admin
  nav) reads active decisions from LAPI (`/v1/decisions`) and shows blocked IPs/scope/scenario, with
  a clear "not configured / unreachable" state.

The **agent now ships bundled** (docker-compose `crowdsec` service under the `firewall` profile,
matching Dokploy). It auto-registers the Caddy bouncer from `CROWDSEC_BOUNCER_KEY` on first boot, and
the bouncer plugin is already compiled into the shipped Caddy image — so enabling is just _set the two
env vars + start the profile_; no manual `cscli`, no image rebuild. Phase 1 enforces the **CAPI
community blocklist** (auto-pulled, no log acquisition). Phase 2 (local log-based scenarios) needs
Caddy access logs written to a file the agent can tail — today they stream `output net` to the control
plane, not to disk. Aligns with `competitor-observability`.

## 11. Phasing

- **Phase 1 — same-apex slice (prove the mechanism).** `protected` column, `buildHttpBlock`
  `forward_auth`, the `/deploy-authz` endpoint reading the Better-Auth session directly (cookie
  scoped to the platform apex via `crossSubDomainCookies`). Covers `*.otterdeploy.app` default
  domains only. Smallest end-to-end proof.
- **Phase 2 — cross-domain handoff (the real requirement).** Add `/authorize` + `/callback`, the
  per-domain `__otter_auth` cookie, token signing, and the Caddy `handle /.well-known/otterdeploy/*`
  block. `/deploy-authz` switches from reading the session to validating the per-domain cookie.
  Unlocks `autodeploy.com` + `plane.com` + custom domains with true SSO.
- **Phase 3 — polish & parity.** Interstitial screen, shareable links / automation-bypass,
  edge-JWT perf path, instant revocation if needed.
- **Phase 4 (independent) — CrowdSec.** Caddy bouncer + agent + Firewall UI. No ordering dependency.

## 12. Where this lives in code

| Concern | Location |
|---|---|
| Protection flag | `packages/db/src/schema/proxy-route.ts`, `caddy/queries.ts` |
| Caddy `forward_auth` + reserved-path `handle` | `packages/api/src/caddy/builder.ts` (`buildHttpBlock`) |
| Reconcile/apply | `packages/api/src/caddy/reconciler.ts` (unchanged) |
| `/authorize`, `/callback`, `/deploy-authz` | `apps/server/src/index.ts` (new `// ─── ───` section) |
| Session + membership lookups | `packages/auth/src/index.ts`, `project.organizationId`, `member` |
| Token/cookie signing helper | new `packages/api/src/authz/` (HMAC sign/verify) |
| Cookie domain config (Phase 1 only) | `packages/auth/src/index.ts` (`crossSubDomainCookies`) |
| CrowdSec bouncer | `infra/caddy/` (xcaddy build), new Firewall router + UI |
| Toggle UI | deployment/networking panel + `proxyRoute` oRPC mutation |
