# Gap audit: Railway networking / domains / edge vs otterdeploy

**Source:** The networking screens from the same real "waves" deployment (see
`gap-audit-railway-vs-otterdeploy.md` for the build/deploy half). This companion doc focuses
on **public domains, DNS, TLS, edge, and private networking** — the area where otterdeploy hurt
the most (a healthy container that was never reachable, a cert stuck at `unknown`).

Ironically, the custom domain Railway is serving in these shots is `waves-p.otterdeploy.com` —
i.e., an otterdeploy.com subdomain pointed *at Railway*. Railway's domain/DNS flow is exactly
what otterdeploy's own edge should feel like.

---

## What Railway shows (verbatim from the UI)

**Public Networking** — "Access your application over HTTP with the following domains":
- `waves-production-bd45.up.railway.app` — auto-generated, instantly live, copy/edit/delete.
- `waves-p.otterdeploy.com` — custom domain, shows `→ Port 8000 · Cloudflare proxy detected ·
  View Documentation`.
- Buttons: **+ Custom Domain**, **+ TCP Proxy**.

**Configure DNS Records** modal (after adding a custom domain):
- **One-click DNS Setup** via a Cloudflare integration: *"Railway automatically configures the
  DNS records"* + a **Connect** button.
- **or** manual, zone-aware, copyable records ("Add both of the following DNS records to
  otterdeploy.com"):
  - `CNAME  waves                  → pzkh791i.up.railway.app`
  - `TXT    _railway-verify.waves  → railway-verify=e6c257d5d9741d2ae5b41dc7ad…`
- **View Documentation** link inline.

**Private Networking**:
- `waves.railway.internal` (IPv4 & IPv6) — *"Ready to talk privately · You can also simply call
  me `waves`"*.

**Settings are organized** into: Source, Networking, **Edge**, Scale, Build, Deploy,
Config-as-code, Feature-flags, Danger.

---

## Gaps for otterdeploy, with the tie-back to our failures

### 1. Instant, trustworthy public URL (the core failure)
- **otterdeploy:** the generated domain (`waves.otterstack.dev`) returned bare empty-`200`s /
  `502`s while the container was healthy; the request never reached the app. `certState` sat at
  `unknown`, `certCheckedAt: null` indefinitely.
- **Railway:** the generated `*.up.railway.app` domain worked the instant the build was green —
  TLS included, no state to babysit.
- **Recommendation:** the generated domain must be a **guaranteed-working, TLS-terminated URL
  the moment a healthy container exists.** If it can't route, say why (see #6), never serve an
  empty 200.

### 2. Custom domains as a first-class, guided flow
- **otterdeploy:** custom-domain handling was opaque; adding/removing the auto domain left it
  `isPrimary: false` and needed `set-primary`, and routing changed on re-add.
- **Railway:** one **+ Custom Domain** button → a modal that (a) detects the target zone, (b)
  gives exact copyable records, (c) offers one-click automation, (d) verifies ownership.
- **Recommendation:** a single "add custom domain" flow that produces zone-aware, copyable DNS
  records and a clear verification path — in both dashboard and CLI (`otterdeploy domains add
  <service> <domain>` should print the exact records to create).

### 3. One-click DNS via a DNS-provider integration
- **Railway:** a Cloudflare integration that *configures the DNS records for you* ("Connect").
- **otterdeploy:** none — DNS is entirely manual and undocumented in the CLI.
- **Recommendation:** offer a one-click DNS setup for the common providers (Cloudflare first),
  and at minimum emit the exact records to add. This removes the single biggest source of
  "my domain doesn't work."

### 4. Domain-ownership verification (TXT) before issuing a cert
- **Railway:** issues a `TXT _railway-verify.<sub> = railway-verify=…` record alongside the
  CNAME, so cert issuance only proceeds once ownership + DNS are proven.
- **otterdeploy:** the cert sat at `unknown` with no verification story surfaced — you couldn't
  tell whether DNS, verification, or ACME was the blocker.
- **Recommendation:** explicit verification records + a visible state machine:
  `dns_pending → verifying → cert_issuing → live | failed(reason)`. Never leave a live domain
  at `unknown`.

### 5. Cloudflare-proxy detection
- **Railway:** shows **"Cloudflare proxy detected"** on the custom domain and links docs — it
  *knows* the domain is proxied (orange-cloud) and adapts guidance (proxy can break TLS
  handshakes / origin routing if misconfigured).
- **otterdeploy:** no proxy awareness. Given our `otterstack.dev` cert was stuck at `unknown`,
  a proxied/misconfigured DNS in front of the edge is exactly the class of problem Railway
  surfaces and otterdeploy silently swallowed.
- **Recommendation:** detect when a custom (or platform) domain resolves through a proxy
  (Cloudflare et al.) and warn, since it changes how TLS + origin routing must be set up.

### 6. Per-domain port routing, shown explicitly
- **Railway:** the custom domain row shows `→ Port 8000` — the container port the domain routes
  to is explicit and editable.
- **otterdeploy:** the container port was set via `--expose service:port` but never surfaced,
  and after we removed the Docker host `ports:` mapping the edge had nothing to route to — with
  no indication of the mismatch.
- **Recommendation:** show and let users edit the **target container port per domain**, and
  validate at deploy time that something is actually listening on it (`no process listening on
  container port 8000` beats a silent empty 200).

### 7. Multiple domains per service, cleanly listed
- **Railway:** generated + custom domains listed together, each with copy/edit/delete.
- **otterdeploy:** `domains list` worked only for services (rejected composes), and the model
  was confusing.
- **Recommendation:** one uniform domain list per resource (services *and* compose stacks),
  copy/edit/delete each, mark primary automatically when it's the only one.

### 8. TCP Proxy for non-HTTP
- **Railway:** a **+ TCP Proxy** button for raw TCP services.
- **Recommendation:** offer a TCP/`raw` exposure path (our app also needed WebSockets/binary
  streaming — HTTP-only edges are a poor fit).

### 9. Private networking with a friendly internal alias
- **Railway:** `waves.railway.internal` (IPv4 & IPv6), *"you can also simply call me `waves`"* —
  service-to-service comms are documented and discoverable.
- **otterdeploy:** an `internal_hostname` field existed in the manifest but there was no
  surfaced private-networking story.
- **Recommendation:** first-class private networking: a stable internal DNS name per service
  (`<service>.<project>.internal`) plus a short in-project alias, shown in the UI/CLI.

### 10. Networking/Edge as clear settings sections
- **Railway:** dedicated **Networking**, **Edge**, and **Scale** sections.
- **Recommendation:** give the edge/proxy its own visible surface with routing status, target
  port, TLS/cert state, and proxy detection — so "why isn't my domain working?" is answerable
  from one screen instead of guessed at.

---

## Priority order (networking)

1. **Generated domain always routes to a healthy container, with real TLS** (#1) — the empty-200
   failure is the flagship bug.
2. **Cert/verification state machine that's never `unknown`** (#4) + **clear 502-with-reason
   when the edge can't reach the upstream** (#6) — make routing/cert failures legible.
3. **First-class custom-domain flow with zone-aware DNS records + ownership TXT** (#2, #4).
4. **Cloudflare-proxy detection** (#5) and **one-click DNS integration** (#3).
5. **Per-domain target port shown/validated** (#6), **uniform multi-domain list incl. composes**
   (#7), **private networking alias** (#9), **TCP proxy** (#8), **Edge settings surface** (#10).

---

*The single sharpest lesson mirrors the build-side one: Railway makes network state **legible**
(port, cert state, proxy detection, verification records) and **guaranteed** (a green build ⇒ a
working URL). otterdeploy's edge was neither — a healthy container with an unreachable URL and a
perpetually `unknown` cert, and no screen that would tell you why.*
