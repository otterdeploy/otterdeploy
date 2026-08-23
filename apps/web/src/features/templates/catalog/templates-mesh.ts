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
    description:
      "WireGuard-based private network control plane: management, signal, relay and STUN in one container, with an embedded Dex identity provider so it needs no external IdP. Point otterdeploy's private networking at it to keep services off the public internet.",
    category: "security",
    includes: ["netbird", "dashboard"],
    requiredEnv: [
      {
        key: "NETBIRD_DOMAIN",
        description:
          "Public base URL of this install, scheme included (https://vpn.example.com). Peers and the dashboard's auth redirects are pinned to it, so changing it later re-enrols every peer.",
      },
      {
        key: "NETBIRD_AUTH_SECRET",
        description: "Shared secret the relay authenticates peers with.",
        generateHint: "openssl rand -base64 32",
      },
      {
        key: "NETBIRD_STORE_ENCRYPTION_KEY",
        description:
          "Encrypts peer records at rest. Unique per install, and losing it makes the store unreadable.",
        generateHint: "openssl rand -base64 32",
      },
    ],
    logoBrand: "NetBird",
    docsUrl: "https://docs.netbird.io/selfhosted/selfhosted-quickstart",
    files: [{ path: "config.yaml", content: NETBIRD_CONFIG, interpolate: true }],
    // No reverse proxy of their own: otterdeploy's edge owns 80/443 and would
    // collide with the Traefik their installer offers. STUN is the exception —
    // 3478/udp is published directly, because the edge speaks HTTP and has no
    // UDP path.
    compose: `name: netbird
services:
  netbird:
    image: netbirdio/netbird-server:0.77.1
    volumes:
      - ./config.yaml:/etc/netbird/config.yaml
      - netbird_data:/var/lib/netbird
    ports:
      - "80"
      - "3478/udp"
    restart: always
  dashboard:
    image: netbirdio/dashboard:v2.91.1
    depends_on:
      - netbird
    environment:
      NETBIRD_MGMT_API_ENDPOINT: "\${NETBIRD_DOMAIN}"
      NETBIRD_MGMT_GRPC_API_ENDPOINT: "\${NETBIRD_DOMAIN}"
      AUTH_AUDIENCE: "netbird"
      AUTH_CLIENT_ID: "netbird"
      AUTH_AUTHORITY: "\${NETBIRD_DOMAIN}/oauth2"
      USE_AUTH0: "false"
      AUTH_SUPPORTED_SCOPES: "openid profile email offline_access api"
      NETBIRD_TOKEN_SOURCE: "idToken"
    ports:
      - "80"
    restart: always
volumes:
  netbird_data:
`,
  },
];
