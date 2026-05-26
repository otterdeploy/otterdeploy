export const PLATFORM = {
  database: {
    publicBaseDomain: "db.otterstack.dev",
    publicPort: 5432,
    internalBaseDomain: "otterstack.internal",
    internalPort: 5432,
    localHost: "127.0.0.1",
  },
  docker: {
    resourceNetwork: "otterstack-resources",
    // Pinned to 17 — postgres:18+ refuses our /var/lib/postgresql/data mount
    // (the v18 image manages its own version/cluster subdirs and considers a
    // mount placed directly at .../data to be an "unused volume"). Upgrade
    // requires changing the swarm mount target + a data-dir migration path.
    postgresImage: "postgres:17-alpine",
  },
  swarm: {
    networkPrefix: "otterstack-",
    caddyContainer: "otterstack-caddy",
  },
  files: {
    // Host path that file-type mounts get materialized under. Each service
    // gets a subdirectory named by its swarm service name; individual
    // file-mount rows write to relative paths beneath that. Must exist
    // and be writable on every swarm node that could schedule a task —
    // either via a shared filesystem or by bind-mounting the same host
    // path on every node. Override via OTTERSTACK_FILES_ROOT for tests.
    root: process.env.OTTERSTACK_FILES_ROOT ?? "/var/lib/otterstack/files",
  },
  service: {
    publicBaseDomain: "apps.otterstack.dev",
    serviceNamePrefix: "otterstack-svc-",
  },
} as const;
