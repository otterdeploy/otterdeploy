// Overlay-network / VPN templates. See ./types.ts for the honesty contract.
import type { StackTemplate } from "./types";

export const NETWORK_TEMPLATES: StackTemplate[] = [
  {
    id: "netbird",
    name: "NetBird",
    description:
      "WireGuard mesh VPN with an admin dashboard, embedded identity provider and setup-key enrolment. The combined server runs management, signal and relay behind one domain; peers reach it over 443 only.",
    category: "security",
    includes: ["proxy", "server", "dashboard"],
    requiredEnv: [
      {
        key: "NETBIRD_DOMAIN",
        description:
          "Public hostname for the whole stack (dashboard, API and peer traffic share it). Expose the `proxy` service on exactly this domain: the embedded IdP issues tokens for it, so a mismatch fails every login.",
      },
      {
        key: "NETBIRD_ADMIN_EMAIL",
        description: "Email for the initial admin account, created on first boot.",
      },
      {
        key: "NETBIRD_ADMIN_PASSWORD",
        description: "Password for that initial admin. Change it after the first sign-in.",
      },
      {
        key: "NETBIRD_RELAY_SECRET",
        description: "Shared secret peers authenticate to the bundled relay with.",
        generateHint: "openssl rand -base64 32 | tr -d '='",
      },
      {
        key: "NETBIRD_STORE_KEY",
        description:
          "Encrypts peer keys and account data in the SQLite store. Losing it makes the store unreadable.",
        generateHint: "openssl rand -base64 32",
      },
      {
        key: "NETBIRD_COOKIE_KEY",
        description: "Encrypts the embedded IdP's session cookies. Must be 16, 24 or 32 bytes.",
        generateHint: "openssl rand -hex 16",
      },
    ],
    logoBrand: "NetBird",
    docsUrl: "https://docs.netbird.io/selfhosted/selfhosted-quickstart",
    // Two baked configs, both written by the container's own entrypoint, so the
    // stack needs no host bind-mounts: the images ship without a config file
    // and `netbird-server` exits(1) on a missing /etc/netbird/config.yaml.
    //
    // `proxy` exists because NetBird serves the dashboard and the server on ONE
    // origin split by path (the IdP issuer, the OAuth redirect URIs and the
    // peer endpoints are all the same host), and a platform route maps one
    // domain to one upstream. It also normalizes protocols: the gRPC prefixes
    // go out as h2c whether the edge arrives over HTTP/1.1 or HTTP/2.
    compose: `name: netbird
services:
  proxy:
    image: caddy:2.11.4-alpine
    depends_on:
      - server
      - dashboard
    environment:
      NB_SERVER_UPSTREAM: "\${{stack.server.HOST}}:80"
      NB_DASHBOARD_UPSTREAM: "\${{stack.dashboard.HOST}}:80"
    entrypoint:
      - /bin/sh
      - -c
      - |
        cat > /etc/caddy/Caddyfile <<CADDYFILE
        {
          admin off
          auto_https off
          servers {
            protocols h1 h2c
            trusted_proxies static private_ranges
          }
        }

        :80 {
          @grpc path /signalexchange.SignalExchange/* /management.ManagementService/* /management.ProxyService/*
          handle @grpc {
            reverse_proxy h2c://$\${NB_SERVER_UPSTREAM}
          }
          handle /api* {
            reverse_proxy $\${NB_SERVER_UPSTREAM}
          }
          handle /oauth2* {
            reverse_proxy $\${NB_SERVER_UPSTREAM}
          }
          handle /relay* {
            reverse_proxy $\${NB_SERVER_UPSTREAM}
          }
          handle /ws-proxy/* {
            reverse_proxy $\${NB_SERVER_UPSTREAM}
          }
          handle {
            reverse_proxy $\${NB_DASHBOARD_UPSTREAM}
          }
        }
        CADDYFILE
        exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
    ports:
      - "80"
    restart: always
  server:
    image: netbirdio/netbird-server:0.77.1
    entrypoint:
      - /bin/sh
      - -c
      - |
        mkdir -p /etc/netbird
        cat > /etc/netbird/config.yaml <<'CONFIG'
        server:
          listenAddress: ":80"
          exposedAddress: "https://\${NETBIRD_DOMAIN}:443"
          metricsPort: 9090
          healthcheckAddress: ":9000"
          logLevel: "info"
          logFile: "console"
          authSecret: "\${NETBIRD_RELAY_SECRET}"
          dataDir: "/var/lib/netbird"
          stuns:
            - uri: "stun:stun.l.google.com:19302"
            - uri: "stun:stun.cloudflare.com:3478"
          auth:
            issuer: "https://\${NETBIRD_DOMAIN}/oauth2"
            signKeyRefreshEnabled: true
            sessionCookieEncryptionKey: "\${NETBIRD_COOKIE_KEY}"
            dashboardRedirectURIs:
              - "https://\${NETBIRD_DOMAIN}/nb-auth"
              - "https://\${NETBIRD_DOMAIN}/nb-silent-auth"
            cliRedirectURIs:
              - "http://localhost:53000/"
            owner:
              email: "\${NETBIRD_ADMIN_EMAIL}"
              password: "\${NETBIRD_ADMIN_PASSWORD}"
          reverseProxy:
            trustedHTTPProxies:
              - "10.0.0.0/8"
              - "172.16.0.0/12"
              - "192.168.0.0/16"
          store:
            engine: "sqlite"
            encryptionKey: "\${NETBIRD_STORE_KEY}"
        CONFIG
        exec /go/bin/netbird-server --config /etc/netbird/config.yaml
    volumes:
      - netbird-data:/var/lib/netbird
    restart: always
  dashboard:
    image: netbirdio/dashboard:v2.91.1
    environment:
      NETBIRD_MGMT_API_ENDPOINT: "https://\${NETBIRD_DOMAIN}"
      NETBIRD_MGMT_GRPC_API_ENDPOINT: "https://\${NETBIRD_DOMAIN}"
      AUTH_AUTHORITY: "https://\${NETBIRD_DOMAIN}/oauth2"
      AUTH_AUDIENCE: netbird-dashboard
      AUTH_CLIENT_ID: netbird-dashboard
      AUTH_CLIENT_SECRET: ""
      AUTH_SUPPORTED_SCOPES: "openid profile email groups"
      AUTH_REDIRECT_URI: /nb-auth
      AUTH_SILENT_REDIRECT_URI: /nb-silent-auth
      USE_AUTH0: "false"
    restart: always
volumes:
  netbird-data:
`,
  },
];
