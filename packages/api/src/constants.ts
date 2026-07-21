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
    // Pinned to 17 — postgres:18+ refuses our /var/lib/postgresql/data mount
    // (the v18 image manages its own version/cluster subdirs and considers a
    // mount placed directly at .../data to be an "unused volume"). Upgrade
    // requires changing the swarm mount target + a data-dir migration path.
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
    serviceNamePrefix: "od-",
  },
} as const;
