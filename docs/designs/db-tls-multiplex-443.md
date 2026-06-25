# Public database access over :443 (TLS-SNI multiplex)

## Problem

Public Postgres today is reachable on **port 5432**, in two independent places:

1. **Edge** — `buildLayer4Block` emits a caddy-l4 listener on `:5432` that
   matches `tls sni <domain>`, terminates TLS (ALPN `postgresql`), and proxies
   plaintext to the DB's overlay alias (`builder.ts:191`).
2. **Swarm** — when a DB is made public, `env.ts` adds an `EndpointSpec.Ports`
   entry publishing `<hostPort>:5432` on the node, so the container port is
   bound directly on the host.

We do **not** want public traffic on 5432. Everything public should arrive on
**:443** and be routed by TLS-SNI: Postgres connections to the DB, everything
else to the HTTP app. Closing 5432 also shrinks the firewall surface to a
single port.

The pieces are already half-aligned with this: the public connection string is
built with `sslnegotiation: "direct"` (`create-stream.ts:213`) — Postgres 17
direct-TLS, which opens with a TLS ClientHello (so an SNI router can dispatch
it) and, per the protocol, carries ALPN `postgresql`.

## Target shape

The HTTP server **stays on :443**. The caddy-l4 `layer4` **listener wrapper**
sits in front of that listener (via `servers { listener_wrappers { … } }`):
Postgres connections (matched by SNI **and** ALPN) are proxied out before TLS
termination; the trailing `tls` wrapper terminates everything else as normal
HTTPS. No second port, no binding conflict — this is the original design from
`docs/superpowers/specs/2026-04-06-caddy-rework-design.md`, which the current
code drifted away from (it emits a standalone `:5432` listener instead).

```caddyfile
{
  admin 0.0.0.0:2019
  servers {
    listener_wrappers {
      layer4 {
        @db1 tls {
          alpn postgresql
          sni db1.<domain>
        }
        route @db1 {
          tls { connection_policy { alpn postgresql } }
          proxy db1.<internal>:5432
        }
      }
      tls          # everything not consumed above → normal HTTPS termination
    }
  }
}

# HTTP site blocks are UNCHANGED — still :443
app.<domain> { reverse_proxy app.<internal>:3000 }
```

- **Connection string:** now carries an explicit `:443`
  (`postgres://…@host:443/db?sslmode=require&sslnegotiation=direct`). The
  current code omits the port to rely on the 5432 default; once the listener
  moves, the default is wrong, so the port must be explicit.
- **`PLATFORM.database.publicPort`:** `5432 → 443`. Schema default is already
  443, so they finally agree.
- **Swarm publish:** stop adding the `5432` host-publish in `env.ts`. The DB is
  reachable from the edge via the overlay alias (l4 `proxy` target) and from
  same-project apps via the overlay alias directly — neither needs a host port.

## Why SNI **and** ALPN (the ACME trap)

caddy-l4 matching DB traffic by SNI alone would also capture the domain's ACME
**TLS-ALPN-01** challenge (same SNI, ALPN `acme-tls/1`). That request would be
routed into the `route @db` branch and terminated with a cert that hasn't been
issued yet → the challenge can never complete → the cert never issues.

Matching `tls sni <domain> alpn postgresql` scopes the DB branch to real
Postgres direct-TLS clients. The `acme-tls/1` challenge has a different ALPN, so
it falls through to `@web` and is passed raw to the HTTP app on :8443, which
terminates it and answers the challenge. HTTP-01 (port 80) is unaffected — l4
only owns 443; the HTTP app keeps :80.

## Why HTTP blocks don't change

The `layer4` listener wrapper attaches to the HTTP server's existing `:443`
listener — it isn't a second listener, so there's no port conflict and the HTTP
site blocks are untouched. A wrapper either consumes a connection (Postgres) or
passes it to the next wrapper (`tls`), which terminates HTTPS exactly as today.
HTTP/2 ALPN, ACME, edge logs, CrowdSec, forward_auth — all unaffected.

`infra/caddy` already bundles `caddy-l4`; **local `caddy` is vanilla**, so
`caddy adapt`/`validate` of the wrapper only works inside that image. Unit tests
pin the generated string; runtime validation needs the image (or a CI job).

## Files

| File | Change |
| --- | --- |
| `packages/api/src/caddy/builder.ts` | `buildLayer4Block` → emit matchers/routes for `servers { listener_wrappers { layer4 { … } tls } }` (no listen port); matcher is `tls { alpn postgresql; sni <domain> }` |
| `packages/api/src/constants.ts` | `database.publicPort` `5432 → 443` |
| `packages/api/src/routers/project/postgres/create-stream.ts` | public conn string includes explicit `:443`; update the "no port" comment |
| `packages/api/src/routers/project/postgres/env.ts` | drop the `5432` `EndpointSpec.Ports` host-publish |
| `packages/api/src/caddy/__tests__/builder.test.ts` | update `:5432` expectations → `:443` + ALPN + passthrough |

## Open questions

1. Internal HTTP port — `8443` chosen arbitrarily; any conflict with existing
   binds (control-plane, portless range)?
2. Non-Postgres engines (redis `6379`, …) were the original reason the listener
   was engine-port-keyed. They'd follow the same SNI+ALPN model on :443, but
   Redis has no standard TLS ALPN — those stay TODO / keep a dedicated port.
3. Validation: add a CI job that builds `infra/caddy` and runs `caddy adapt`
   over a representative generated Caddyfile, since local caddy can't.
