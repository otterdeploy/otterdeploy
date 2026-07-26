# VPS firewall layering (od-5j8.11)

## Why

od-5j8.5 built the firewall ROUTER (CrowdSec decisions read/write, blocklist
ingestion) and a per-node CrowdSec bouncer install path, but left three gaps
that made "CrowdSec bundled and blocking hostile traffic on every node" an
aspiration rather than a default:

1. **No host-level packet filtering at all.** Nothing closed inbound ports
   except what the platform needs — a fresh VPS exposed whatever the distro's
   own defaults left open, and Docker Swarm's control-plane ports
   (2377/7946/4789) were reachable from the entire internet on every node.
2. **Opt-in behind two manual steps.** `docker-compose.prod.yml` — the
   compose file `install.sh` actually fetches to a host — was missing the
   CrowdSec log-acquisition wiring (`crowdsecurity/sshd`/`crowdsecurity/caddy`
   collections, the acquis config, the host-log + Caddy-log mounts) that the
   dev compose (`docker-compose.yml`) already had. In production, a fresh
   install's CrowdSec agent could only ever consume the community CAPI
   blocklist — SSH brute force and HTTP/CVE probes never generated a
   decision, regardless of whether the operator flipped the profile on.
3. **Primary/node parity gap.** `docker-compose.yml` accepted a
   `CROWDSEC_FIREWALL_BOUNCER_KEY` and claimed "install.sh sets it up as a
   systemd service" — that was never actually implemented. Nodes added via
   the dashboard DID get a native bouncer (`provision-firewall.ts`); the
   primary host itself never did.

This doc records the layering decision this issue implements, what's
automatic vs. operator-owned, and — because this was built and reviewed on
a macOS dev machine with no nftables — precisely what's verified vs. not.

## Layering decision

Two layers, one tool (`nftables`), one mental model:

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 2 — CrowdSec (dynamic, IP-reputation)                  │
│   • Caddy-edge bouncer  (HTTP requests, Caddy plugin)         │
│   • Native firewall bouncer (host-wide, crowdsec-firewall-    │
│     bouncer, nftables mode) — writes into the SAME nftables   │
│     ruleset as layer 1                                        │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ Layer 1 — host nftables baseline (static, default-deny)       │
│   table inet otterdeploy                                      │
│   chain input: policy drop                                    │
│     allow: lo, established/related, icmp(v6) ping/unreachable,│
│            SSH (detected port), 80/443                        │
│     allow (peer-scoped only): 2377/tcp, 7946/tcp+udp, 4789/udp│
│   DOCKER-USER guard (ip filter, Docker's own chain):           │
│     drop NEW forwarded connections to any port but 80/443     │
└─────────────────────────────────────────────────────────────┘
```

**Who owns what:**

- **Layer 1 (nftables baseline)** is the platform's own, applied by
  `scripts/install.sh` (`provision_host_firewall`) on the primary and by
  `packages/api/src/routers/server/provision-host-firewall.ts` (over SSH,
  during provisioning) on every node added afterward. It's what makes
  "closes everything except what the platform needs" true even with
  CrowdSec entirely disabled.
- **Layer 2 (CrowdSec)** adds the dynamic, reputation-driven bans on top —
  it's what makes "blocks hostile IP traffic," not just "closes unused
  ports," true. Two bouncers, same LAPI:
  - the **Caddy plugin bouncer** (already existed, od-5j8.5) — HTTP-layer,
    only sees requests that reach Caddy.
  - the **native firewall bouncer** (`crowdsec-firewall-bouncer`, mode
    `nftables`) — host-wide, blocks a banned IP at the packet level
    regardless of destination port (SSH included). Runs as a systemd
    service outside any container (upstream ships no container image, and it
    needs to own the host's nftables).
- **Docker itself** is the reason layer 1 needs the `DOCKER-USER` guard
  in addition to the `input` chain: dockerd manipulates iptables/nftables
  DIRECTLY for published container ports (DNAT into `FORWARD` via its own
  `DOCKER-USER` chain, created and evaluated before Docker's own permissive
  rules) — the classic ufw+Docker footgun where an `INPUT`-only firewall
  never sees published-port traffic at all. Docker Swarm's own
  control-plane ports are different: dockerd binds them itself as plain
  host listeners, so `INPUT`-chain rules correctly gate them — no
  `DOCKER-USER` involvement needed there.
- **The operator's own firewall (ufw/firewalld)**, if already active, wins
  outright — `provision_host_firewall` / `installHostFirewall` detect it and
  skip installing nftables alongside it (narrated, `firewallStatus:
  "unsupported"`), rather than risking two managers fighting over the same
  netfilter hooks. The CrowdSec bouncers still work in that case; only the
  static baseline is the operator's own responsibility (a short hint is
  printed: `sudo ufw allow 80,443/tcp`).

## Enabled by default

Previously: two manual steps (`CROWDSEC_BOUNCER_KEY`/`CROWDSEC_LAPI_URL` env
vars, then `docker compose --profile firewall up -d`), undocumented outside
the Firewall page's own empty state.

Now: `OTTERDEPLOY_FIREWALL` defaults to `true`. A fresh `install.sh` run:

1. Generates `CROWDSEC_BOUNCER_KEY`, `CROWDSEC_LAPI_URL`, and
   `CROWDSEC_FIREWALL_BOUNCER_KEY` into `.env` (preserved across re-runs via
   the existing `keep_or` convention).
2. Applies the nftables baseline (`provision_host_firewall`).
3. Starts the `firewall` compose profile (`start_stack`'s existing
   `--profile firewall` logic, now hit by default).
4. Installs the native bouncer on the primary (`provision_native_bouncer`) —
   the parity gap described above.

Explicit opt-out: `OTTERDEPLOY_FIREWALL=false` / `--no-firewall`. The
Firewall page's "not enabled" empty state (`FirewallDisabledCard`) is what an
operator sees only after actively opting out — for a default install it's
replaced by the real decisions view within a few seconds of the agent
starting (`firewall.status`'s `configured || reachable` gate, unchanged).

## Every node, not just the primary

- **New nodes** (`server.provision` → `provision-runner.ts`): after a node
  joins the swarm, two more best-effort SSH steps run — the existing
  `installNodeFirewallBouncer` (per-node CrowdSec bouncer, od-5j8.5) and the
  new `installHostFirewall` (the same nftables baseline, peer set built from
  the org's other registered servers + the manager address). Neither
  failure fails the join; both are recorded on the server row.
- **Drift tracking**: `server.firewall_status` (`unknown | applied | failed
  | unsupported`) + `server.firewall_bouncer_active` persist the outcome.
  `unknown` is the honest default — every row that predates this feature, or
  whose provisioning run never reached the step, reads as **not known to be
  protected**, never as a false "applied". `isFirewallDrifted()`
  (`host-firewall.ts`) is the single classifier both a future UI and the
  test suite read.
- **Remediation**: `server.reapplyFirewall` (oRPC) enqueues the same
  `server.provision` job in `firewallOnly` mode — reconnects over the stored
  managed SSH key and re-runs just the two firewall steps, without touching
  Docker/swarm-join state. Requires a stored `sshKeyId` (a one-time
  bootstrap password is never persisted past the initial join — same
  constraint `retryProvision` already enforces).

### Known limitation: the primary's peer set isn't live-updated

The primary's nftables peer set (which other IPs may reach 2377/7946/4789)
is computed by `install.sh` from the LOCAL Docker swarm membership at
install time — it has real host access to do that. The control plane itself
(`packages/api`) runs as an **unprivileged container** (no host network
namespace, no `NET_ADMIN`) and cannot reach out and update the primary
host's own nftables table when a node joins later — it CAN do this for a
node it's actively SSH-provisioning (that node's ruleset is rendered
fresh, with the current peer list, every time), but not retroactively for
the primary's own, already-applied table.

**Practical effect:** on a single-manager install where nodes are added
after the initial `install.sh` run, the manager's own peer set stays empty
(or stale) until the operator does one of:

- Re-run `install.sh` on the primary (idempotent, secrets preserved) — it
  re-reads current swarm membership and re-renders the peer set.
- `sudo nft add element inet otterdeploy otterdeploy_peers { <node-ip> }`
  for immediate, no-restart remediation.

This is a real gap, not fully solved by this issue — closing it properly
needs either a privileged sidecar with host netns access or a host agent
the control plane can command (the same shape the health agent already uses
for read-only host stats — see `docs/designs/server-health-agent.md` — could
plausibly grow a narrow, allow-listed "add this element to this set"
capability). Filed as follow-up work rather than solved here.

## Recovery

Lockout risk is the standard objection to any host firewall change, so:

- `ct state established,related accept` is evaluated before any port rule
  in the generated ruleset — the SSH session the installer/provisioner is
  already running over survives even a wrong SSH-port detection; only a NEW
  connection would be refused.
- The current sshd port is always detected (`sshd -T`) and explicitly
  allow-listed — never hardcoded to 22.
- The ruleset is syntax-checked (`nft -c -f`) before it's ever loaded live.
- The entire baseline lives in ONE named table (`inet otterdeploy`) —
  `sudo nft delete table inet otterdeploy` (or `install.sh
  firewall-rollback`) atomically and safely removes it, with nothing to
  partially apply.
- `install.sh firewall-status` gives a read-only view of both layers
  (nftables table presence, native bouncer service state) without touching
  anything.

## Verified vs. unverified

This was implemented and reviewed on a macOS dev machine (Docker Desktop,
no nftables, no systemd, no real VPS). What that means concretely:

**Verified (unit tests, `packages/api/src/__tests__/security/od-5j8.11-*`):**

- The exact rendered nftables ruleset text — default-deny policy, every
  swarm port scoped to `@otterdeploy_peers` (never a bare world-reachable
  accept), 80/443 + the given SSH port unconditionally allowed, lockout
  guards present, peer-set dedup/empty-set handling.
- The `DOCKER-USER` guard script text — insert/idempotent-delete-by-comment,
  drop-new-non-80/443 semantics, graceful skip when the chain doesn't exist.
- The full install-script composition (`hostFirewallInstallScript`) —
  ufw/firewalld precedence, syntax validation before apply, reboot
  persistence, marker file.
- DB schema defaults (`firewall_status` → `unknown`), the drift classifier,
  and that both the full-provision and firewall-only remediation code paths
  call `patchServerFirewall` (so an attempted-but-failed run is still
  recorded, never silently dropped).
- The client-IP attribution invariant: edge-log ingestion reads Caddy's own
  connection fields (never a forwarded header), and the control plane's own
  `sanitizeForwardingHeaders` still runs before evlog's audit middleware.
- `bash -n` syntax-checks `scripts/install.sh`; the new bash functions were
  sourced and exercised in isolation (heredoc/peer-set rendering, SSH-port
  detection) to confirm they produce the exact same ruleset shape as the TS
  renderer.
- `docker compose -f docker-compose.prod.yml config` validates the compose
  changes (acquis config, collections, log mounts, LAPI port bind) parse.

**NOT verified (no Linux VPS / nftables / systemd available in this
environment):**

- That `nft -f` actually loads the rendered ruleset without error on a real
  kernel/nftables version, and that the resulting policy behaves as
  described (an actual port scan from an external host was not run).
- That the `DOCKER-USER` insertion syntax is accepted by a real dockerd's
  iptables-nft-created chain, and that a test container publish is actually
  dropped.
- That `crowdsec-firewall-bouncer-nftables` installs cleanly from
  packagecloud and that its systemd unit starts and enforces LAPI decisions
  end-to-end (mirrors the pre-existing, also-unverified-on-this-machine
  per-node bouncer path from od-5j8.5).
- SSH lockout recovery under an ACTUAL bad ruleset on a real host — the
  `ct state established,related` reasoning is standard nftables behavior,
  not something exercised against a live sshd here.
- The `install.sh` end-to-end run past `preflight` (it refuses non-Linux
  hosts by design) — only `--dry-run`-style code paths and individually
  sourced functions were exercised.

Operators deploying this on a real VPS should treat the first `install.sh`
run as the actual first verification of the host-firewall path, and are
encouraged to keep an existing SSH session open (or console/out-of-band
access available) until they've confirmed a NEW SSH connection still works.

## Files

- `packages/api/src/routers/server/host-firewall.ts` — pure nftables/script
  renderers + drift classifier (TS side, used for nodes added post-install).
- `packages/api/src/routers/server/provision-host-firewall.ts` — SSH runner.
- `packages/api/src/routers/server/provision-runner.ts` — wiring into the
  join flow + the `firewallOnly` remediation branch.
- `packages/db/src/schema/server.ts` — `firewall_status` /
  `firewall_applied_at` / `firewall_error` / `firewall_bouncer_active`.
- `scripts/install.sh` — `provision_host_firewall`, `provision_native_bouncer`,
  `firewall_rollback`, `firewall_status_cmd`, default-on wiring.
- `docker-compose.prod.yml` — CrowdSec log-acquisition parity fix.
- `packages/api/src/__tests__/security/od-5j8.11-*.test.ts`.
