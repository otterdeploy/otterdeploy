# Tailscale — per-org tailnet for mesh, private + public ingress, admin access

## Why

Today multi-node is Docker Swarm joined over the public internet: the operator
pastes `docker swarm join --token … <ip>:2377` (`server/join-tokens.ts`) and the
manager's `2377`/SSH sit on a public IP. That's the same posture
Coolify/Dokploy take (SSH + Docker socket per server — see `research/`, and
`backups.md:213` "Coolify/Dokploy assume SSH/agent access per server"). It
works, but it means exposing the control plane to the internet and hand-rolling
firewall rules per node.

Tailscale collapses four problems into one private mesh:

1. **Connect remote nodes (mesh)** — nodes join the org's tailnet; the control
   plane reaches their Docker daemon over a `100.x` address, not public `:2377`.
2. **Private service networking** — a deployed service is reachable *only* from
   the org's own devices/team (Tailscale Serve), never public.
3. **Public ingress via Funnel** — a service is reachable on
   `<name>.<tailnet>.ts.net` with auto-HTTPS, no public DNS or ACME needed.
4. **Operator/admin access** — internal dashboards (Workbench/BullMQ, db studio,
   metrics) reachable over the tailnet + Tailscale SSH, never public.

Neither competitor uses Tailscale — this is a genuine differentiator, so there's
no prior-art pattern to copy; this design follows Tailscale's own best practices
(OAuth clients → ephemeral tagged auth keys, tag-based ACLs).

## Ownership model: per-org, bring-your-own tailnet

Each **org connects its own Tailscale account**. Their nodes and services live
on *their* tailnet, billed to *them*, governed by *their* ACLs. We never run a
shared platform tailnet (cross-org isolation would then ride entirely on our ACL
correctness — too much blast radius). This also is the only model that satisfies
pillar 2: a user's service can only be reachable "from their own devices" if it's
on their tailnet.

### Auth: OAuth client → ephemeral tagged auth keys

The org pastes a **Tailscale OAuth client** (client id + secret, scoped
`devices:write` / `auth_keys`, bound to tags) into Settings → Tailscale. We store
it like we store GitHub App secrets today: **on a DB row, encrypted at rest via
`ln`** (`packages/api/src/lib/crypto.ts`) — **never env vars** (mirrors the
git-provider precedent, `env/src/server.ts:98-102`). The control plane then mints
**short-lived, ephemeral, pre-authorized, tagged auth keys** on demand (at
node-join / service-attach) via the Tailscale API. Ephemeral ⇒ nodes/services
that go away are auto-removed from the tailnet; tagged ⇒ ACL-addressable and not
tied to a human's identity.

**Tags** (the org adds these to their tailnet policy; we surface the exact
snippet in the connect UI):

- `tag:otter-node` — cluster hosts (the mesh).
- `tag:otter-svc` — deployed services attached to the tailnet (Serve/Funnel).
- `tag:otter-admin` — the control plane itself (admin-access pillar).

ACL requirements we document for the operator (autoApprovers so our ephemeral
keys self-authorize, plus the Funnel grant for pillar 3):

```jsonc
"tagOwners":     { "tag:otter-node": ["autogroup:admin"], "tag:otter-svc": [...], "tag:otter-admin": [...] },
"autoApprovers": { "routes": { … }, "exitNode": [...] },
"grants":        [ { "src": ["tag:otter-admin"], "dst": ["tag:otter-node"], "ip": ["*"] } ],
// Funnel (pillar 3): nodeAttrs → "funnel" for tag:otter-svc
```

## Schema

### New: `org_tailnet` (one row per org, like `git`)

`packages/db/src/schema/tailnet.ts`

```ts
org_tailnet:
  organizationId   FK organization (unique)   // one tailnet per org
  tailnetName      text                        // e.g. "example.org.github" / "tailcafe.ts.net"
  oauthClientId    text                        // not secret, but stored together
  oauthClientSecret text                       // ENCRYPTED via `ln`
  status           enum(connected|error|disconnected)
  lastVerifiedAt   timestamp                   // last successful API whoami
  createdAt / updatedAt
```

### Extend: `server` (mesh pillar)

`packages/db/src/schema/server.ts` — add Tailscale identity columns. The existing
`host` becomes the node's Tailscale `100.x` address (or MagicDNS name) once it
joins, so every existing call site that dials `host` transparently goes over the
tailnet:

```ts
tailscaleNodeId   text  // stable Tailscale device id (for de-dupe + removal)
tailscaleIp       text  // 100.x.y.z
tailscaleDnsName  text  // <host>.<tailnet>.ts.net (MagicDNS)
```

This phase finally wires the long-reserved `daemonVersion` field: the node agent
self-registers capacity + version after join (`contract.ts:36-38` already
anticipates this).

### Extend: service/route exposure (pillars 1 + 3)

Add a tailnet-exposure mode alongside the existing public Caddy route. Smallest
fit is a column on the service/proxy-route layer:

```ts
tailnetExposure  enum(none | private | funnel)  default none
// none    → public Caddy route only (today's behavior)
// private → Tailscale Serve: reachable from org's tailnet devices only
// funnel  → Tailscale Funnel: public <name>.<tailnet>.ts.net + auto-HTTPS
```

## Runtime / data plane

- **Mesh (pillar 1).** A node runs `tailscaled` (installed by the join agent),
  joins with an ephemeral `tag:otter-node` key, and the control plane talks to
  its Docker daemon over the tailnet address. `runtime()` (the Swarm driver,
  `runtime/swarm-driver.ts`) gains per-node targeting: resolve a `ServerId` →
  its `tailscaleIp` → a Docker client bound to that host. Swarm's own
  control-plane traffic (`2377`/`4789`/`7946`) also rides the tailnet, so those
  ports never face the internet.
- **Private + public service exposure (pillars 2 + 4).** A service marked
  `private`/`funnel` gets a **Tailscale sidecar** (`tsnet` or a `tailscale`
  container) attached to the project network, joined with an ephemeral
  `tag:otter-svc` key, running `tailscale serve` (private) or `tailscale funnel`
  (public) at the service's port. Caddy is untouched for these — Tailscale is the
  edge. `none` keeps the current Caddy + proxy-route path verbatim.
- **Admin access (pillar 3).** The control-plane host joins as `tag:otter-admin`;
  internal-only services (Workbench, db studio, metrics) are bound to the tailnet
  interface + reachable via Tailscale SSH, dropping their public exposure
  (`WORKBENCH_USER/PASS` basic-auth becomes belt-and-suspenders, not the gate).

## API surface

New `tailnet` oRPC router (org-scoped, `requirePermission` like `server`/backups,
see `org-rbac-better-auth`):

- `tailnet.connect` — store OAuth client (encrypt secret via `ln`), verify with a
  Tailscale API whoami, return `tailnetName` + the ACL snippet to paste.
- `tailnet.status` — connected/error + `lastVerifiedAt` + device counts.
- `tailnet.disconnect` — soft-delete the row; existing devices keep running.
- `tailnet.joinKey` — mint a one-shot ephemeral `tag:otter-node` key (consumed by
  the node-join script/agent).
- Extend `server.create` flow with a "Join over Tailscale" path that returns the
  `tailscale up --authkey=… --advertise-tags=tag:otter-node` one-liner instead of
  `docker swarm join`.

## Phases

1. **Connect** — `org_tailnet` schema + `db:push`; `ln`-encrypted OAuth client;
   `tailnet.connect/status/disconnect`; Settings → Tailscale UI (connect form +
   ACL snippet + verified status). No data-plane change yet. *Shippable: orgs can
   link a tailnet and we can mint keys.*
2. **Mesh** — `server` Tailscale columns; node-join agent (installs `tailscaled`,
   joins ephemeral-tagged, self-registers capacity → wires `daemonVersion`);
   per-node Docker targeting in the Swarm driver; UI "Join over Tailscale".
3. **Private networking (Serve)** — `tailnetExposure=private`; per-service
   `tag:otter-svc` sidecar + `tailscale serve`; exposure control on the
   service/domains card. *Reachable from org devices only.*
4. **Public ingress (Funnel)** — `tailnetExposure=funnel`; `tailscale funnel` +
   document the Funnel ACL grant; surface the `*.ts.net` URL alongside custom
   domains.
5. **Admin access** — control plane as `tag:otter-admin`; bind Workbench/studio/
   metrics to the tailnet + Tailscale SSH; drop their public exposure.

## Open questions / risks

- **`tailscaled` on the host vs in a container.** Host install is the robust path
  for the mesh (kernel WireGuard, MagicDNS); a container needs `--privileged`/TUN.
  The join agent should prefer host install, fall back to container.
- **Funnel constraints.** Funnel only serves `:443/:8443/:10000` and needs the
  HTTPS + Funnel node-attr in ACLs; not every org will enable it. Detect + show a
  clear "enable Funnel in your tailnet" error rather than failing opaquely.
- **OAuth scope drift.** If the org's OAuth client lacks `auth_keys`, key-minting
  fails — `tailnet.connect` must validate scopes up front, not at first join.
- **Sidecar overhead.** One `tsnet`/sidecar per exposed service. For many small
  services consider a single shared `tag:otter-svc` proxy that fans out via
  `tailscale serve` path-/host-routing, rather than N sidecars.
- **Swarm coupling.** Mesh targeting assumes the Swarm driver. The default
  `docker` driver is single-node; multi-node Tailscale mesh implies
  `DEPLOY_RUNTIME=swarm`. Document that, or design a node-addressed plain-docker
  path later.
- **Cleanup.** Ephemeral keys auto-expire devices, but `disconnect` should also
  revoke the OAuth client server-side if the org asks for a hard teardown.
