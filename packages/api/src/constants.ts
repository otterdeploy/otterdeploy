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
    root: process.env.OTTERDEPLOY_FILES_ROOT ?? "/var/lib/otterdeploy/files",
  },
  service: {
    serviceNamePrefix: "otterdeploy-svc-",
  },
} as const;
