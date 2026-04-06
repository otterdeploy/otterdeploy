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
    postgresImage: "postgres:18-alpine",
  },
} as const;
