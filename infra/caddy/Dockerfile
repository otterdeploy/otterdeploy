FROM caddy:2-builder-alpine AS builder

# caddy-l4         — layer-4 (TLS-SNI) proxying for database routes
# caddy-crowdsec-bouncer — IP-reputation gate (deployment-protection.md §10);
#   provides the global `crowdsec { … }` app + the per-site `crowdsec` handler
RUN xcaddy build \
  --with github.com/mholt/caddy-l4 \
  --with github.com/hslatman/caddy-crowdsec-bouncer/http

FROM caddy:2-alpine

COPY --from=builder /usr/bin/caddy /usr/bin/caddy
