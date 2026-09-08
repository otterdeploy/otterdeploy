// Private-networking control planes. See ./types.ts for the honesty contract.
//
// Why this category exists at all: otterdeploy's mesh integration
// (packages/db/src/schema/mesh.ts) is bring-your-own account, and the design
// note is explicit that we never run a shared platform mesh — cross-org
// isolation would then rest on our own ACL correctness. That leaves two ways
// to get private networking: a NetBird *cloud* account, which is a SaaS
// dependency inside a self-host-first product, or self-hosting the control
// plane by hand. This template is the second one, made one click.
//
// It composes with the existing integration and needs no new code there:
// `managementUrl` is the ONLY difference between hosted and self-hosted
// (docs/designs/vpn-mesh.md:56). Deploy this, then paste its URL and a PAT
// into Settings → Private networking.
import type { StackTemplate } from "./types";

/**
 * NetBird keeps `authSecret` and `store.encryptionKey` in config.yaml and
 * reads neither from the environment — the combined server's loader
 * (combined/cmd/config.go) is plain yaml.v3 with no env binding at all. So the
 * file has to carry them, and shipping it as literal text would hand every
 * install that deployed this template the same two keys.
 *
 * `interpolate: true` is what makes that safe: the refs below resolve at
 * materialize time against the stack's own variables, so the values live
 * encrypted in the stack env and are only ever rendered onto disk at deploy.
 * catalog.test.ts checks every ref here appears in `requiredEnv`, because an
 * unprompted ref renders EMPTY — and an empty encryption key is a silently
 * insecure install rather than a loud failure.
 */
const NETBIRD_CONFIG = `# Rendered from the otterdeploy template. Values come from the stack's
# variables; see https://docs.netbird.io/selfhosted/maintenance/configuration-files
server:
  listenAddress: ":80"
  exposedAddress: "\${NETBIRD_DOMAIN}"
  logLevel: "info"
  logFile: "console"
  authSecret: "\${NETBIRD_AUTH_SECRET}"
  dataDir: "/var/lib/netbird/"
  stunPorts: [3478]
  auth:
    # REQUIRED, and it gates the whole block: config.go's deriveManagement only
    # copies server.auth onto the management config when issuer is non-empty
    #   if c.Management.Auth.Issuer == "" && c.Server.Auth.Issuer != ""
    # Leave it out and every key below is silently discarded too — the server
    # then dies on "failed to create embedded IDP service: issuer is required"
    # while logging an empty redirect-URI list that this file plainly sets.
    #
    # The /oauth2 suffix is load-bearing: the IdP derives the dashboard's base
    # URL with strings.TrimSuffix(issuer, "/oauth2") (idp/embedded.go), and it
    # has to equal the dashboard's own AUTH_AUTHORITY below.
    issuer: "\${NETBIRD_DOMAIN}/oauth2"
    # Dex ships inside the server image, so a self-hosted install needs no
    # external IdP to get its first admin in.
    localAuthDisabled: false
    dashboardRedirectURIs:
      - "\${NETBIRD_DOMAIN}/nb-auth"
      - "\${NETBIRD_DOMAIN}/nb-silent-auth"
    cliRedirectURIs:
      - "http://localhost:53000/"
  store:
    engine: "sqlite"
    encryptionKey: "\${NETBIRD_STORE_ENCRYPTION_KEY}"
`;

export const MESH_TEMPLATES: StackTemplate[] = [
  {
    id: "netbird",
    name: "NetBird",
    descriptionKey: "templates.catalog.netbird.description",
    category: "security",
    includes: ["netbird", "dashboard", "proxy"],
    requiredEnv: [
      {
        key: "NETBIRD_DOMAIN",
        descriptionKey: "templates.catalog.netbird.env.NETBIRD_DOMAIN",
      },
      {
        key: "NETBIRD_AUTH_SECRET",
        descriptionKey: "templates.catalog.netbird.env.NETBIRD_AUTH_SECRET",
        generateHint: "openssl rand -base64 32",
      },
      {
        key: "NETBIRD_STORE_ENCRYPTION_KEY",
        descriptionKey: "templates.catalog.netbird.env.NETBIRD_STORE_ENCRYPTION_KEY",
        generateHint: "openssl rand -base64 32",
        // Not decorative: `crypt.NewFieldEncrypt` runs
        // `base64.StdEncoding.DecodeString` over this and rejects anything
        // that doesn't come out at exactly 32 bytes (util/crypt/crypt.go).
        // The wizard's default url-safe 24-byte secret satisfies neither.
        generate: { encoding: "base64", bytes: 32 },
      },
    ],
    logoBrand: "NetBird",
    docsUrl: "https://docs.netbird.io/selfhosted/selfhosted-quickstart",
    files: [{ path: "config.yaml", content: NETBIRD_CONFIG, interpolate: true }],
    // NetBird is one hostname with a PATH split: the dashboard at `/`, the
    // server (API, embedded IdP at /oauth2, relay, gRPC) underneath it. Its
    // own quickstart hands that split to Traefik/Caddy/nginx on the host.
    // otterdeploy's edge routes a domain to ONE service and has no path
    // rules, so the first version of this template exposed BOTH `netbird`
    // and `dashboard` on port 80: whichever got the domain ate the other's
    // traffic. With the domain on the dashboard, `${NETBIRD_DOMAIN}/oauth2`
    // resolved to a Next.js page, OIDC discovery came back as HTML, and every
    // login ended on "Oops, something went wrong: Unauthenticated".
    //
    // `proxy` is the stack's own path router, on the overlay only (no host
    // ports; the edge still owns 80/443). It is the ONE service to expose:
    // the four rules are NetBird's documented Caddy config verbatim
    // (docs.netbird.io/selfhosted/external-reverse-proxy), including h2c for
    // gRPC so peers reach management/signal through it. The Caddyfile rides
    // in `command` rather than `files` on purpose: an existing stack can only
    // have its compose file replaced through the editor, not gain a second
    // file, so this shape is the one an operator can paste into a stack that
    // was created before the fix. STUN stays a direct UDP publish: the edge
    // speaks HTTP and has no UDP path.
    //
    // AUTH_CLIENT_ID is `netbird-dashboard`, not `netbird`: the embedded Dex
    // registers exactly two clients, `netbird-dashboard` and `netbird-cli`.
    // With `netbird` the dashboard sent an id the IdP had never heard of, and
    // every sign-in ended on Dex's own "Bad Request: Invalid client_id
    // provided" while management logged
    // `ERRO [client_id: netbird] invalid client_id provided`. AUTH_AUDIENCE
    // matches it because Dex mints the id token with `aud` = the client id.
    compose: `name: netbird
services:
  netbird:
    image: netbirdio/netbird-server:0.77.1
    volumes:
      - ./config.yaml:/etc/netbird/config.yaml
      - netbird_data:/var/lib/netbird
    ports:
      - "3478/udp"
    restart: always
  dashboard:
    image: netbirdio/dashboard:v2.91.1
    depends_on:
      - netbird
    # The four OIDC values below are not free-form: the combined server hard-codes
    # the audience it will accept (config.go: httpConfig.AuthAudience =
    # "netbird-dashboard"), the embedded Dex registers exactly one dashboard
    # client id ("netbird-dashboard", idp/embedded.go), Dex rejects any scope it
    # does not know with invalid_scope, and it matches redirect_uri literally
    # against the list config.yaml registers above. The dashboard otherwise
    # defaults to "/#callback", which is not one of them.
    environment:
      NETBIRD_MGMT_API_ENDPOINT: "\${NETBIRD_DOMAIN}"
      NETBIRD_MGMT_GRPC_API_ENDPOINT: "\${NETBIRD_DOMAIN}"
      AUTH_AUDIENCE: "netbird-dashboard"
      AUTH_CLIENT_ID: "netbird-dashboard"
      AUTH_AUTHORITY: "\${NETBIRD_DOMAIN}/oauth2"
      USE_AUTH0: "false"
      AUTH_SUPPORTED_SCOPES: "openid profile email groups"
      AUTH_REDIRECT_URI: "/nb-auth"
      AUTH_SILENT_REDIRECT_URI: "/nb-silent-auth"
      NETBIRD_TOKEN_SOURCE: "idToken"
    restart: always
  proxy:
    image: caddy:2-alpine
    depends_on:
      - netbird
      - dashboard
    command:
      - sh
      - -c
      - |
        printf '%s\\n' \\
          '{' \\
          '  admin off' \\
          '  auto_https off' \\
          '}' \\
          ':80 {' \\
          '  @grpc header Content-Type application/grpc*' \\
          '  reverse_proxy @grpc h2c://netbird:80' \\
          '  @backend path /relay* /ws-proxy/* /api/* /oauth2/*' \\
          '  reverse_proxy @backend netbird:80' \\
          '  reverse_proxy /* dashboard:80' \\
          '}' > /etc/caddy/Caddyfile
        exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
    # The sidecar speaks h2c to netbird, but that only matters if the request
    # still IS gRPC when it arrives. The edge's own hop is upstream of this
    # one and defaults to HTTP/1.1, which strips HTTP/2 before the @grpc
    # matcher above can ever fire — so peers could not register even with the
    # path split fixed (#239's parting note). This label is what tells the
    # edge to dial "h2c://proxy:80" instead.
    labels:
      otterdeploy.upstream.protocol: h2c
    ports:
      - "80"
    restart: always
volumes:
  netbird_data:
`,
  },
];
