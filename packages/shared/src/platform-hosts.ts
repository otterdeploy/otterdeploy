/**
 * The platform's own containers, as a name a raw route directive could dial
 * .
 *
 * The edge sits on the shared `otterdeploy` network next to the control
 * plane's datastores and services, and on every project network. A
 * `reverse_proxy redis:6379` therefore reaches the install's own Redis (the
 * job queue), `server:3000` the control plane, `crowdsec:8080` the LAPI. Route
 * directives exist to proxy to the tenant's own services, never to these.
 *
 * Pure (no node:*): the dashboard runs the reach rules as form validation too.
 */

/**
 * The platform's compose services. Each key is a DNS alias on the shared
 * network. Read from docker-compose.yml (dev) and docker-compose.prod.yml
 * (what install.sh runs): `postgres`, `redis`, `server`, `builder`, `caddy`,
 * `crowdsec`. packages/api/src/caddy/__tests__/directive-reach-internal.test.ts
 * parses both files and fails when a service appears there but not here.
 */
const PLATFORM_SERVICES = ["postgres", "redis", "server", "builder", "caddy", "crowdsec"] as const;

/**
 * Every exact name that is the platform:
 *  - the compose service keys above;
 *  - their `container_name`s (`otterdeploy-<service>`, docker-compose.yml);
 *  - containers the control plane creates at runtime: the per-node edge
 *    (`otterdeploy-caddy-node`, routers/server/provision-node-proxy.ts), the
 *    health agent (`otterdeploy-health-agent`, system-health/agent-service.ts)
 *    and buildkitd (`buildx_buildkit_otterdeploy-cache0`, apps/builder/src/buildx.ts).
 * Compose's default `otterdeploy-<service>-<n>` names (prod sets no
 * container_name for most services) are matched by PLATFORM_REPLICA below.
 */
const PLATFORM_HOSTS: ReadonlySet<string> = new Set([
  ...PLATFORM_SERVICES,
  ...PLATFORM_SERVICES.map((service) => `otterdeploy-${service}`),
  "otterdeploy-caddy-node",
  "otterdeploy-health-agent",
  "buildx_buildkit_otterdeploy-cache0",
]);

const PLATFORM_REPLICA = new RegExp(`^otterdeploy-(?:${PLATFORM_SERVICES.join("|")})-\\d+$`);

/** The suffix every managed database's internal alias carries
 *  (PLATFORM.database.internalBaseDomain in packages/api/src/constants.ts). */
const INTERNAL_DATABASE_DOMAIN = "otterdeploy.internal";

/** `<slot or node id>.<task id>`: what follows a service name in a swarm task's
 *  container name (`od-shop-api.1.<25-char id>`). */
const SWARM_TASK_SUFFIX = /^[a-z0-9]+\.[a-z0-9]{25}$/;

/** The host as Caddy's dialer would see it, canonicalized through the URL
 *  parser so `0x7f.1`, `[::ffff:127.0.0.1]` and `0` read as what they are (an
 *  IPv6 literal keeps its brackets; a trailing root dot is dropped). */
export function canonicalHostname(host: string): string {
  const bare = host.toLowerCase().replace(/\.$/, "");
  const candidate = bare.includes(":") && !bare.startsWith("[") ? `[${bare}]` : bare;
  return URL.canParse(`http://${candidate}`) ? new URL(`http://${candidate}`).hostname : bare;
}

/** Whether `host` is an IP literal in any spelling the dialer accepts. */
export function isIpLiteral(host: string): boolean {
  const canonical = canonicalHostname(host);
  return canonical.startsWith("[") || /^\d+\.\d+\.\d+\.\d+$/.test(canonical);
}

/**
 * The name Docker's embedded DNS answers `host` with, or null when `host` is an
 * IP literal or an ordinary DNS name Docker forwards to the outside resolver.
 * Docker answers, on any network the edge shares with the target:
 *  - a single label (service, alias, container name or id);
 *  - `<name>.<network>` (the `otterdeploy` network and every
 *    `otterdeploy-<project>` one);
 *  - `tasks.<service>` (a swarm service's task IPs);
 *  - `<service>.<slot>.<task id>` (a swarm task's container name);
 *  - a database's `<name>.otterdeploy.internal` alias.
 */
export function dockerDnsName(host: string): string | null {
  if (isIpLiteral(host)) return null;
  const name = host.toLowerCase().replace(/\.$/, "");
  if (name.endsWith(`.${INTERNAL_DATABASE_DOMAIN}`)) return name;
  const labels = name.split(".");
  if (labels.length === 1) return name;
  if (labels[0] === "tasks") return dockerDnsName(labels.slice(1).join("."));
  const network = labels.at(-1) ?? "";
  if (network === "otterdeploy" || network.startsWith("otterdeploy-")) {
    return dockerDnsName(labels.slice(0, -1).join("."));
  }
  if (SWARM_TASK_SUFFIX.test(labels.slice(1).join("."))) return labels[0] ?? null;
  return null;
}

/** Why `host` is the platform itself rather than a tenant upstream, or null. */
export function platformHostError(host: string): string | null {
  const name = host.toLowerCase().replace(/\.$/, "");
  if (name === "docker.internal" || name.endsWith(".docker.internal")) {
    return `${JSON.stringify(host)} is the Docker host: route directives cannot reach the machine the edge runs on.`;
  }
  const dns = dockerDnsName(host);
  if (dns !== null && (PLATFORM_HOSTS.has(dns) || PLATFORM_REPLICA.test(dns))) {
    return `${JSON.stringify(host)} is otterdeploy's own ${JSON.stringify(dns)} container: route directives can only reach your own services.`;
  }
  return null;
}

/**
 * Whether `host` is a link-local address: 169.254.0.0/16 (which carries the
 * cloud metadata endpoint 169.254.169.254) or fe80::/10, in any spelling the
 * dialer accepts, IPv4-mapped included.
 */
export function isLinkLocalHost(host: string): boolean {
  const canonical = canonicalHostname(host);
  if (canonical.startsWith("169.254.")) return true;
  if (/^\[fe[89ab][0-9a-f]?:/.test(canonical)) return true;
  // ::ffff:169.254.x.x canonicalizes to ::ffff:a9fe:xxxx.
  return /^\[::ffff:a9fe:[0-9a-f]{1,4}\]$/.test(canonical);
}
