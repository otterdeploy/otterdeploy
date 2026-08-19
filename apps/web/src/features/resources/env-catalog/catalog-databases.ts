/**
 * Env suggestions for the database / infra images the platform ships in
 * templates and database resources. Official docker-library entrypoint vars
 * are stable across the majors we pin; each entry names its source.
 *
 * Deliberately absent: redis / valkey (the official images take configuration
 * via redis.conf or command flags, not env) and amazon/dynamodb-local (jar
 * arguments only). Listing invented vars would violate the catalog contract.
 */
import type { ImageEnvCatalogEntry } from "./types";

export const DATABASE_ENV_CATALOG: ImageEnvCatalogEntry[] = [
  {
    images: ["postgres"],
    verifiedAgainst: "docker-library/postgres entrypoint docs, majors 16-18 (2026-08)",
    vars: [
      {
        key: "POSTGRES_PASSWORD",
        description: "Superuser password. The only variable the image requires.",
        secret: true,
        required: true,
      },
      {
        key: "POSTGRES_USER",
        description: "Superuser name; a database with the same name is created.",
        defaultValue: "postgres",
      },
      {
        key: "POSTGRES_DB",
        description: "Name of the default database; falls back to POSTGRES_USER.",
      },
      {
        key: "POSTGRES_INITDB_ARGS",
        description: "Extra arguments passed to initdb on first start.",
        defaultValue: "--data-checksums",
      },
      {
        key: "POSTGRES_INITDB_WALDIR",
        description: "Store the transaction log (WAL) outside the data directory.",
      },
      {
        key: "POSTGRES_HOST_AUTH_METHOD",
        description:
          "Auth method for host connections, e.g. scram-sha-256. trust disables passwords entirely.",
      },
      {
        key: "PGDATA",
        description: "Data directory path inside the container.",
      },
    ],
  },
  {
    images: ["mysql"],
    verifiedAgainst: "docker-library/mysql entrypoint docs, major 8 (2026-08)",
    vars: [
      {
        key: "MYSQL_ROOT_PASSWORD",
        description: "Password for the root superuser account.",
        secret: true,
        required: true,
      },
      { key: "MYSQL_DATABASE", description: "Database to create on first start." },
      {
        key: "MYSQL_USER",
        description: "Extra user created with full grants on MYSQL_DATABASE. Set both together.",
      },
      {
        key: "MYSQL_PASSWORD",
        description: "Password for MYSQL_USER. Set both together.",
        secret: true,
      },
      {
        key: "MYSQL_ALLOW_EMPTY_PASSWORD",
        description: "yes lets root start with no password. Unsafe outside throwaway dev.",
      },
      {
        key: "MYSQL_RANDOM_ROOT_PASSWORD",
        description: "yes generates a root password and prints it once to the container log.",
      },
      {
        key: "MYSQL_ONETIME_PASSWORD",
        description: "Marks the root password expired; it must be changed on first login.",
      },
      {
        key: "MYSQL_ROOT_HOST",
        description: "Host mask root may connect from.",
        defaultValue: "%",
      },
      {
        key: "MYSQL_INITDB_SKIP_TZINFO",
        description: "Skip loading timezone tables on first start.",
      },
    ],
  },
  {
    images: ["mariadb"],
    verifiedAgainst: "MariaDB official image docs, major 11 (2026-08)",
    vars: [
      {
        key: "MARIADB_ROOT_PASSWORD",
        description: "Password for the root superuser account.",
        secret: true,
        required: true,
      },
      { key: "MARIADB_DATABASE", description: "Database to create on first start." },
      {
        key: "MARIADB_USER",
        description: "Extra user created with full grants on MARIADB_DATABASE. Set both together.",
      },
      {
        key: "MARIADB_PASSWORD",
        description: "Password for MARIADB_USER. Set both together.",
        secret: true,
      },
      {
        key: "MARIADB_RANDOM_ROOT_PASSWORD",
        description: "yes generates a root password and prints it once to the container log.",
      },
      {
        key: "MARIADB_ALLOW_EMPTY_ROOT_PASSWORD",
        description: "yes lets root start with no password. Unsafe outside throwaway dev.",
      },
      {
        key: "MARIADB_AUTO_UPGRADE",
        description: "Run mariadb-upgrade automatically after an image version bump.",
        defaultValue: "1",
      },
      {
        key: "MARIADB_ROOT_HOST",
        description: "Host mask root may connect from.",
        defaultValue: "%",
      },
      {
        key: "MARIADB_INITDB_SKIP_TZINFO",
        description: "Skip loading timezone tables on first start.",
      },
    ],
  },
  {
    images: ["minio/minio"],
    verifiedAgainst: "MinIO server docs (2026-08)",
    vars: [
      {
        key: "MINIO_ROOT_USER",
        description: "Root access key. Replaces the insecure minioadmin default.",
        required: true,
      },
      {
        key: "MINIO_ROOT_PASSWORD",
        description: "Root secret key, 8 characters minimum.",
        secret: true,
        required: true,
      },
      {
        key: "MINIO_BROWSER",
        description: "off disables the embedded web console.",
      },
      {
        key: "MINIO_SERVER_URL",
        description: "Public URL clients reach the S3 API on; needed behind a proxy.",
      },
      {
        key: "MINIO_BROWSER_REDIRECT_URL",
        description: "Public URL of the web console when it is proxied on its own host.",
      },
      {
        key: "MINIO_DOMAIN",
        description: "Enables virtual-host-style bucket URLs under this domain.",
      },
    ],
  },
  {
    images: ["rabbitmq"],
    verifiedAgainst: "RabbitMQ official image docs, 3.13 (2026-08)",
    vars: [
      {
        key: "RABBITMQ_DEFAULT_USER",
        description: "Username created on first start.",
        defaultValue: "guest",
      },
      {
        key: "RABBITMQ_DEFAULT_PASS",
        description: "Password for the default user.",
        secret: true,
      },
      {
        key: "RABBITMQ_DEFAULT_VHOST",
        description: "Virtual host created on first start.",
        defaultValue: "/",
      },
      {
        key: "RABBITMQ_NODENAME",
        description: "Erlang node name; only matters for clustering.",
      },
    ],
  },
  {
    images: ["docker.dragonflydb.io/dragonflydb/dragonfly", "dragonflydb/dragonfly"],
    verifiedAgainst: "Dragonfly flags docs, v1.27 (2026-08). DFLY_ prefix is case-sensitive.",
    vars: [
      {
        key: "DFLY_requirepass",
        description: "Password clients must AUTH with (the requirepass flag).",
        secret: true,
      },
      {
        key: "DFLY_maxmemory",
        description: "Memory limit, e.g. 4gb. 0 sizes automatically from the container limit.",
      },
      {
        key: "DFLY_proactor_threads",
        description: "IO thread count. 0 uses all CPU cores.",
      },
      {
        key: "DFLY_snapshot_cron",
        description: "Crontab schedule for automatic snapshots.",
      },
      {
        key: "DFLY_cache_mode",
        description: "true evicts least-recently-used keys as memory fills, Redis-cache style.",
      },
      {
        key: "DFLY_dbnum",
        description: "Number of logical databases.",
        defaultValue: "16",
      },
    ],
  },
];
