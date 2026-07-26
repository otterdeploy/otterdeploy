export const PLATFORM = {
  database: {
    // Public Postgres rides on :443 by TLS-SNI (caddy-l4 listener wrapper),
    // next to HTTP — never a raw 5432 on the host. See
    // docs/designs/db-tls-multiplex-443.md.
    publicPort: 443,
    internalBaseDomain: "otterdeploy.internal",
    internalPort: 5432,
    localHost: "127.0.0.1",
  },
  docker: {
    resourceNetwork: "otterdeploy-resources",
    // Used only by the legacy single-container dev provisioner in
    // ./docker/postgres.ts (no current callers — the wizard's create path
    // goes through the swarm adapter in ./swarm/database-engines/postgres.ts,
    // which is version-aware). Kept pinned to 17 here since that file's mount
    // target is hardcoded and hasn't been updated for 18's layout.
    postgresImage: "postgres:17-alpine",
  },
  swarm: {
    networkPrefix: "otterdeploy-",
    caddyContainer: "otterdeploy-caddy",
  },
  files: {
    // Host path that file-type mounts get materialized under. Each service
    // gets a subdirectory named by its swarm service name; individual
    // file-mount rows write to relative paths beneath that. Must exist
    // and be writable on every swarm node that could schedule a task —
    // either via a shared filesystem or by bind-mounting the same host
    // path on every node. Override via OTTERDEPLOY_FILES_ROOT for tests.
    // oxlint-disable-next-line node/no-process-env -- leaf config constant evaluated at import; this is a test-only override not part of the validated env schema, and importing @otterdeploy/env into this near-universally-imported module would pull full env validation into the import graph.
    root: process.env.OTTERDEPLOY_FILES_ROOT ?? "/var/lib/otterdeploy/files",
  },
  service: {
    // Swarm service / image-repo prefix. Kept short (`od-`, not the old
    // `otterdeploy-svc-`): the image already lives under the `otterdeploy-local/`
    // registry namespace, so a second full "otterdeploy" was pure redundancy,
    // and the 16-char prefix ate a quarter of Docker's 63-char service-name
    // budget (see the `.slice(0, 63)` in service/handlers.ts). Display strippers
    // in the web app still recognise the legacy prefix for pre-rename services.
    // Compose sub-services carry it too: `${stack}-${service}` on its own is
    // indistinguishable from an arbitrary Docker alias, so a tenant route could
    // point at anything on the overlay network. The prefix is what makes a
    // swarm service a recognisably control-plane-minted identity, which is what
    // caddy/route-validation.ts checks before a host reaches a Caddyfile.
    serviceNamePrefix: "od-",
    // Prefixes a running service may legitimately still carry from before the
    // `od-` rename. Accepted by route validation; never minted. Dropping these
    // would fail every pre-rename service's routes at the Caddyfile boundary.
    legacyServiceNamePrefixes: ["otterdeploy-svc-", "otterdeploy-"],
  },
} as const;
