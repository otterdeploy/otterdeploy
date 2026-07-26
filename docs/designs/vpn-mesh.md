# Private networking — NetBird & Tailscale interop (end-to-end)

> Status: design. Supersedes the unbuilt `docs/designs/tailscale.md` for the
> ownership/exposure model; that doc's Tailscale-specific mechanics (OAuth
> clients, Serve, Funnel) survive as the Tailscale provider implementation.

## Why this exists

Today "mesh" is a single bolted-on step in provisioning. `server.meshProvider`
(`none | tailscale | netbird`) plus `meshInstallScript()`
(`packages/api/src/routers/server/provision.ts:118`) curls the vendor install
script and runs `tailscale up --authkey=…` / `netbird up --setup-key …` with a
key **the operator pastes by hand, once**. The resulting mesh IP is parsed out
and used for exactly one thing: the Docker Swarm `--advertise-addr`.

That is the whole integration. There is no org-level account connection, no API
client, no key minting, no group/tag management, no access policy, no DNS, no
reconcile, no teardown, and — the actual gap — **no way to serve an app on the
VPN only**. Every exposed service goes out through public Caddy on :443 or not
at all.

This design closes that: the VPN becomes a first-class, *optional* network
scope that the existing route/reconcile machinery already knows how to render.

## Non-negotiable: optional, opt-out, never load-bearing

The platform must behave **identically to today** when no VPN is connected, and
every VPN-derived behavior must be individually reversible.

- No VPN connection on the org ⇒ zero new containers, zero new listeners, zero
  new firewall rules, zero new columns read on any hot path. The
  private-networking UI is a single "Connect" card and nothing else.
- `exposureScope` defaults to `public` for every existing and new route. The
  column is additive; no backfill changes behavior.
- Disconnecting the VPN **never** takes an app offline. A service on
  `private` at disconnect time is surfaced as drift ("unreachable — its network
  is disconnected") with a one-click "make public" — we do not silently
  re-expose it to the internet, and we do not silently delete it.
- The mesh sidecar is a compose **profile**. Absent unless connected.
- Node join over a mesh stays optional exactly as it is now, including the
  existing paste-your-own-key path for orgs that never connect an account.

Anything that cannot be turned off is a bug against this design.

## Ownership model: bring-your-own account (hosted *or* self-hosted)

Each org connects **its own** NetBird account or Tailscale tailnet. Peers,
policies and billing live on *their* side. We never run a shared platform mesh —
cross-org isolation would then rest entirely on our own ACL correctness, which
is far too much blast radius for a self-hosted PaaS.

This mirrors the existing `gitProvider` precedent exactly (`packages/db/src/
schema/git.ts`): a per-org row, secrets as AES-GCM ciphertext via
`lib/crypto.ts`, **never env vars**.

NetBird's self-hosted management server is supported by the same code path —
it is just a different `managementUrl` (`https://api.netbird.io` by default).
That is the entire difference, which is why "BYO hosted" and "BYO self-hosted"
are one provider, not two.

## Provider abstraction

NetBird is the reference implementation and ships first; Tailscale implements
the same interface behind it.

```ts
interface MeshProviderClient {
  verify(): Promise<MeshIdentity>;            // whoami — proves creds + scopes
  ensureGroups(spec): Promise<GroupRefs>;     // netbird groups / tailscale tags
  mintNodeKey(opts): Promise<EnrolmentKey>;   // ephemeral, single-use, tagged
  listPeers(): Promise<MeshPeer[]>;           // reconcile + drift detection
  removePeer(id): Promise<void>;              // teardown on server delete
  ensureAccessPolicy(spec): Promise<void>;    // who may reach private services
  privateHostFor(route): string;              // provider's DNS shape
}
```

The two providers differ in exactly one architecturally interesting place —
how a private hostname resolves — and that difference is confined to
`privateHostFor` + the agent's join flags.

## NetBird specifics (verified against the Management API)

- Base URL `https://api.netbird.io/api` (hosted) or `<managementUrl>/api`
  (self-hosted). Auth header is **`Authorization: Token <PAT>`** — *not*
  `Bearer`.
- `POST /api/setup-keys` — `{ name, type: "one-off"|"reusable", expires_in
  (86400..31536000), auto_groups[], usage_limit, ephemeral, allow_extra_dns_labels }`;
  response adds `id, key, expires, valid, revoked, used_times, state`.
- `POST /api/policies` — `{ name, enabled, rules: [{ name, enabled, action:
  "accept"|"drop", bidirectional, protocol, ports[]?, port_ranges[]?,
  sources[], destinations[], destinationResource? }] }`.
- `/api/groups`, `/api/peers`, `/api/networks/{id}/{routers,resources}`,
  `/api/dns/nameservers`, `/api/accounts` for verify.
- Zero-trust by default: **nothing is reachable until a policy says so**, and
  network resources are *not* members of the built-in `All` group.

### The DNS keystone: wildcard extra DNS labels

The hard part of "serve this app only on the VPN" is giving the app a hostname
that resolves *inside* the mesh with no public DNS and no per-service API churn.

NetBird domain-based network *resources* do not solve this: NetBird assigns no
virtual IP for them — "the client resolves the name through the routing peer",
so the routing peer must already be able to resolve it. That just moves the
problem to a resolver we'd have to run.

**Extra DNS labels do solve it, and cleanly.** A peer registered with a
wildcard label:

```
netbird up --setup-key … --extra-dns-labels "*.od"
```

creates a wildcard record `*.od.netbird.cloud` (or the account's custom peer DNS
domain) pointing at that peer's NetBird IP. One label, registered **once at
join**, gives every private service on that node a working internal hostname:

```
<service>-<project>.od.netbird.cloud   →   node peer's mesh IP   →   Caddy (mesh listener)
```

No per-service API call, no external DNS, no nameserver group, no re-running
`netbird up` when a service is added or removed. Requires
`allow_extra_dns_labels: true` on the setup key (the management server rejects
labels otherwise). Max 32 labels/peer; we use one.

Host-header routing inside Caddy fans the wildcard back out to individual
services, which is precisely what the existing reconciler already does for
public domains.

### Tailscale's shape (fast-follow)

Tailscale has no wildcard-label equivalent — MagicDNS gives one name per node
(`<host>.<tailnet>.ts.net`). So Tailscale private exposure uses `tailscale
serve` on the node peer with host/path routing, and Funnel remains the only
public-ingress option. `privateHostFor` absorbs the difference; nothing above
the provider interface changes. Funnel is out of scope for this pass.

## Where private traffic actually lands

Caddy runs as a bridge-networked container publishing `80/443`
(`docker-compose.prod.yml:186`). It therefore cannot see the host's `wt0` /
`tailscale0` interface, so a private site block cannot simply `bind` to the
mesh IP.

**Decision: a `netbird` sidecar sharing Caddy's network namespace.**

```yaml
netbird-edge:
  profiles: ["mesh"]              # absent unless the org connected a VPN
  network_mode: "service:caddy"   # wt0 appears INSIDE caddy's netns
  cap_add: [NET_ADMIN]
  devices: ["/dev/net/tun"]
```

Caddy then sees the mesh interface directly, and private site blocks `bind` to
the mesh IP on **443** — no port suffix in the URL, and, critically, the private
listener is **never bound to a public interface at all**. Reachability is
enforced by the interface binding plus NetBird's own policy, not by our
firewall being correct. The nftables baseline stays as defense-in-depth.

Rejected alternatives, for the record:
- *Private listener on `:8443` published on `0.0.0.0`, restricted by nftables* —
  makes internet-reachability depend on our firewall rules being right, and
  puts an ugly port in every internal URL.
- *Binding the published port to the host's mesh IP* (`"${MESH_IP}:443:443"`) —
  the mesh IP isn't known at compose time and changes on re-enrolment.
- *One VPN peer per service (sidecar per app)* — most "native" in the vendor
  dashboard, but one agent container per service, and peer-count billing on
  Tailscale. Explicitly deferred; the provider interface leaves room for it.

Two peers per machine (the **host** peer for swarm/mesh transport, the **edge**
peer inside Caddy's netns for private ingress) is legal and intentional: they
have different lifetimes and different policy needs.

## Schema

### New: `mesh_network` — one row per org (mirrors `gitProvider`)

```ts
organizationId    FK organization (unique)
provider          enum(netbird | tailscale)
managementUrl     text          // https://api.netbird.io for hosted; self-hosted URL otherwise
apiTokenCiphertext text         // ENCRYPTED via lib/crypto (domain: "mesh-creds")
accountId         text          // provider-side account/tailnet id, from verify()
peerDomain        text          // e.g. netbird.cloud, or the account's custom peer DNS domain
dnsLabel          text          // the wildcard label we register, default "od"
nodeGroupId       text          // provider group/tag holding otterdeploy nodes
accessGroupIds    jsonb         // groups permitted to reach private services
status            enum(connected | error | disconnected)
lastVerifiedAt    timestamp
lastError         text
```

### Extend: `proxy_route`

```ts
exposureScope  enum(public | private | both)  NOT NULL DEFAULT 'public'
```

`public` is today's behavior verbatim. This is the only change to the hot path,
and its default makes it a no-op for every existing row.

### Extend: `server`

Reuses the existing `meshProvider` / `meshAddress` columns. Adds:

```ts
meshPeerId    text   // provider peer id — required for teardown on delete
meshDnsLabel  text   // the wildcard label this node registered
```

## Reconcile

`packages/api/src/caddy/reconciler.ts` gains a second render pass. Routes are
partitioned by `exposureScope`; `public|both` render exactly as they do today,
`private|both` render into mesh-bound site blocks using `privateHostFor()`.
When no VPN is connected the private partition is always empty and the emitted
Caddyfile is byte-identical to today's.

Peer reconcile (drift): compare `listPeers()` against `server` rows — report
orphaned peers and missing peers, never auto-delete.

## API surface

New org-scoped `mesh` oRPC router, `requirePermission` like `server`/`backups`:

- `mesh.connect` — store creds encrypted, `verify()`, ensure groups, return the
  account identity + peer domain.
- `mesh.status` — connected/error, `lastVerifiedAt`, peer counts, drift.
- `mesh.disconnect` — soft-delete; existing peers keep running; private routes
  flagged as drift (never silently re-exposed).
- `mesh.enrolmentKey` — mint an ephemeral one-off key for a node join.
- `mesh.setAccessGroups` — which provider groups may reach private services.
- Extend `service.expose` with an `exposureScope` argument.

## Phases

1. **Connect** — `mesh_network` schema, NetBird API client, provider interface,
   `mesh.connect/status/disconnect`, Settings → Private Networking UI. No data
   plane. *Shippable: an org links NetBird and we can mint keys.*
2. **Managed node join** — key minting replaces the pasted key; `meshPeerId`
   recorded; peer removed on server delete; drift reporting. The manual
   paste-a-key path stays for unconnected orgs.
3. **Private exposure** — `exposureScope`, the netbird-edge sidecar, mesh-bound
   Caddy listener, access policy, per-service exposure control in the UI.
4. **Control plane over VPN** — dashboard/Workbench/db-studio/metrics reachable
   over the mesh; drop their public exposure. Covers NAT'd nodes with no public IP.
5. **Tailscale parity** — same interface, OAuth client → ephemeral tagged keys,
   `tailscale serve` for private. Funnel deferred.

## Risks

- **Disconnect while services are private.** Handled explicitly above (drift,
  never silent re-exposure) — this is the single most dangerous edge.
- **Custom peer DNS domain.** Accounts that changed it away from
  `netbird.cloud` must have `peerDomain` read from the API at connect, not
  assumed.
- **`allow_extra_dns_labels` not set** on a key ⇒ registration is rejected at
  join. `mesh.connect` must validate token scope up front, and key minting must
  always set the flag.
- **Self-hosted NetBird version skew.** The Networks API is newer than the rest;
  we only depend on setup-keys/groups/policies/peers/accounts, all long-stable.
- **Two peers per machine** inflates peer counts on peer-billed plans. Document it.
- **Swarm coupling.** Multi-node mesh implies `DEPLOY_RUNTIME=swarm`, as today.
