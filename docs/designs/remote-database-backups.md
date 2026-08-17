# Remote Databases as Backup Sources (SSH-Tunnel Evaluation)

**Status:** Evaluated 2026-08-17 (od-6et.18). Recommendation: build
**direct-TCP external sources first**, add SSH tunnels only on demand.

## The question

Databasus backs up databases anywhere reachable over an SSH tunnel.
Otterdeploy only backs up resources on its own Docker host (dumps exec inside
the database's own container). Should we add tunnel support?

## What the container-exec model gives up if we bolt tunnels on

Our dump model's two structural advantages both come from exec'ing inside the
target's container: credentials never cross the network, and the dump binary
matches the server version by construction. An external database has no
container, so an external source necessarily runs a **client container** on
the otterdeploy host (image chosen from the reported server version) that
connects out. That is a different execution path regardless of whether the
transport is direct TCP or an SSH tunnel — the tunnel is only the transport.

## Evaluation

| Option | Reach | Cost | Judgment |
|---|---|---|---|
| Direct TCP from a client container | Managed cloud DBs (RDS, Neon, Supabase…), anything with a reachable endpoint — the overwhelming majority of real external-backup asks | New `external database` source entity (host/port/engine/creds, encrypted), client-container runner, version probe | **Build first** |
| SSH tunnel (`ssh -L` inside the client container) | DBs only reachable via a bastion | All of the above + key management for the bastion, tunnel supervision, double failure surface | **On demand** — a clean increment on top of the TCP path (the tunnel wraps the same client container), so deferring it costs no architecture |
| VPN/mesh (existing `mesh_network` integration) | DBs on a connected NetBird/Tailscale network | Zero new backup code once the host joins the mesh — the "remote" DB is just a reachable endpoint | Already effectively supported; document it |

## Recommendation

1. When external sources are prioritized, implement the **client-container
   direct-TCP** path: `backup_external_database` table, engine + version
   probe, creds via the existing crypto envelope, same rustic pipeline.
2. Point users with bastion-only databases at the **mesh integration**
   (docs/designs/vpn-mesh.md) — joining the host to the network makes the
   database a plain reachable endpoint with no per-backup tunnel machinery.
3. Add literal SSH `-L` tunnels only if (1) and (2) leave real demand.

No code shipped for this ticket by design; the evaluation is the deliverable.
