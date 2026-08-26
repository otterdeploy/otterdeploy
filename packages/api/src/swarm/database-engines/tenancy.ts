/**
 * Multi-tenancy on a shared database server.
 *
 * A "tenant" is a logical database + its own login role living inside another
 * database resource's container (see `database_resource.host_resource_id`).
 * Everything engine-specific about carving one out lives here: the admin
 * client invocation, the statements that create and drop a tenant, and the
 * probe that reports how much of the server's connection budget is spent.
 *
 * Statements are returned as strings rather than executed, so they are unit
 * testable without a container, and every identifier/literal is quoted by the
 * helpers below rather than interpolated raw: a tenant name reaches here from
 * an operator-supplied resource name.
 *
 * Only engines with real per-database authentication get an implementation.
 * Redis (numbered DBs share one password) and ClickHouse (no wired admin
 * credential on our containers) deliberately have none, which is what
 * `engineSupportsHosting` reports to the create path.
 */
import type { DatabaseEngine } from "@otterdeploy/shared/database-engines";

/** The tenant's own identity on the shared server. */
export interface TenantIdentity {
  databaseName: string;
  username: string;
  password: string;
  /** Cap on concurrent connections, or null for uncapped. */
  connectionLimit?: number | null;
}

/** The host server's admin identity: the credentials its container was
 *  created with, which are superuser/root for every engine we provision. */
export interface HostAdmin {
  username: string;
  password: string;
  databaseName: string;
}

/** One command to run inside the host's container. `env` carries the password
 *  so it never appears in the container's process list. */
export interface AdminCommand {
  argv: string[];
  env: string[];
}

/**
 * One statement in a tenant plan.
 *
 * `tolerate` is the escape hatch for statements no engine lets us write
 * idempotently. `CREATE DATABASE` is the case: postgres forbids it inside a
 * transaction block, so it cannot go in the `DO $$ … END $$` guard the role
 * uses, and psql's `\gexec` meta-command is not reliably processed by `-c`.
 * Running it and forgiving "already exists" is the honest version of the
 * check; anything else it reports still fails the plan.
 */
export interface TenantStatement {
  sql: string;
  tolerate?: RegExp;
}

export interface ConnectionUsage {
  used: number;
  max: number;
}

export interface DatabaseTenancy {
  /** Wrap one statement as an exec into the host container. */
  adminCommand(admin: HostAdmin, statement: string): AdminCommand;
  /** Statements that create the tenant, in order. Each must be idempotent:
   *  a retried create (a failed apply, a re-run manifest) has to converge
   *  rather than fail on the second attempt. */
  createStatements(tenant: TenantIdentity, admin: HostAdmin): TenantStatement[];
  /** Statements that remove the tenant, in order. Idempotent for the same
   *  reason: a delete that half-succeeded must be retryable. */
  dropStatements(tenant: TenantIdentity, admin: HostAdmin): TenantStatement[];
  /** Statement whose stdout `parseUsage` reads, for the host's connection
   *  budget. */
  usageStatement(): string;
  parseUsage(stdout: string): ConnectionUsage | null;
}

/** Quote a SQL identifier for postgres (embedded double quotes doubled). */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Quote a SQL text literal (embedded single quotes doubled). */
export function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Quote a MySQL/MariaDB identifier (embedded backticks doubled). */
export function quoteBacktick(name: string): string {
  return `\`${name.replace(/`/g, "``")}\``;
}

/** A JS string literal safe to embed in a `mongosh --eval` script. */
export function jsLiteral(value: string): string {
  return JSON.stringify(value);
}

// ── Postgres ────────────────────────────────────────────────────────────

export const postgresTenancy: DatabaseTenancy = {
  adminCommand: (admin, statement) => ({
    argv: [
      "psql",
      "-U",
      admin.username,
      "-d",
      admin.databaseName,
      "-v",
      "ON_ERROR_STOP=1",
      "-t",
      "-A",
      "-c",
      statement,
    ],
    env: [`PGPASSWORD=${admin.password}`],
  }),

  createStatements: (tenant, admin) => {
    const role = quoteIdent(tenant.username);
    const dbName = quoteIdent(tenant.databaseName);
    const limit = tenant.connectionLimit ?? -1;
    return [
      // Role first: CREATE DATABASE ... OWNER needs it to exist. The DO block
      // makes a re-run a password reset rather than a duplicate-object error.
      {
        sql: `DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = ${literal(tenant.username)}) THEN
    EXECUTE format('ALTER ROLE %I WITH LOGIN PASSWORD %L', ${literal(tenant.username)}, ${literal(tenant.password)});
  ELSE
    EXECUTE format('CREATE ROLE %I WITH LOGIN PASSWORD %L', ${literal(tenant.username)}, ${literal(tenant.password)});
  END IF;
END $$;`,
      },
      // See TenantStatement.tolerate: this is the statement that cannot be
      // written idempotently, so a second create forgives the duplicate.
      {
        sql: `CREATE DATABASE ${dbName} OWNER ${role};`,
        tolerate: /already exists/i,
      },
      // Isolation. Postgres grants CONNECT on every database to PUBLIC, so
      // without this revoke every tenant on the server could open a session
      // against every other tenant's database. This is the statement that
      // makes a shared server a boundary rather than a shared namespace.
      { sql: `REVOKE ALL ON DATABASE ${dbName} FROM PUBLIC;` },
      { sql: `GRANT ALL PRIVILEGES ON DATABASE ${dbName} TO ${role};` },
      // Same reasoning one level down: the host's own database is a database
      // like any other, and a tenant role would otherwise be free to open a
      // session against it. The host's owner is a superuser, so it keeps its
      // own access; roles that legitimately need in (an ephemeral credential)
      // are granted CONNECT explicitly at mint time.
      { sql: `REVOKE CONNECT ON DATABASE ${quoteIdent(admin.databaseName)} FROM PUBLIC;` },
      { sql: `ALTER DATABASE ${dbName} CONNECTION LIMIT ${limit};` },
    ];
  },

  dropStatements: (tenant, admin) => {
    const dbName = quoteIdent(tenant.databaseName);
    return [
      // Sessions hold the database open; DROP DATABASE fails while any exist.
      {
        sql: `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${literal(tenant.databaseName)} AND pid <> pg_backend_pid();`,
      },
      { sql: `DROP DATABASE IF EXISTS ${dbName};` },
      // The role can only own objects in databases it was granted access to,
      // which the create path never does beyond its own — so reassigning
      // inside the admin database is enough for the drop to succeed.
      {
        sql: `DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = ${literal(tenant.username)}) THEN
    EXECUTE format('REASSIGN OWNED BY %I TO %I', ${literal(tenant.username)}, ${literal(admin.username)});
    EXECUTE format('DROP OWNED BY %I', ${literal(tenant.username)});
    EXECUTE format('DROP ROLE %I', ${literal(tenant.username)});
  END IF;
END $$;`,
      },
    ];
  },

  usageStatement: () =>
    `SELECT (SELECT count(*) FROM pg_stat_activity) || ' ' || current_setting('max_connections');`,
  parseUsage: (stdout) => parseTwoNumbers(stdout),
};

// ── MariaDB / MySQL ─────────────────────────────────────────────────────

export const mariadbTenancy: DatabaseTenancy = {
  adminCommand: (admin, statement) => ({
    // `mariadb` is the client in image v11+. Password rides MYSQL_PWD rather
    // than `-p`, which the client reads and which keeps it out of `ps`.
    argv: ["mariadb", "-u", admin.username, "--batch", "--skip-column-names", "-e", statement],
    env: [`MYSQL_PWD=${admin.password}`],
  }),

  createStatements: (tenant) => {
    const dbName = quoteBacktick(tenant.databaseName);
    const user = `${literal(tenant.username)}@'%'`;
    // 0 means unlimited in MySQL's grammar, matching NULL here.
    const limit = tenant.connectionLimit ?? 0;
    return [
      { sql: `CREATE DATABASE IF NOT EXISTS ${dbName};` },
      { sql: `CREATE USER IF NOT EXISTS ${user} IDENTIFIED BY ${literal(tenant.password)};` },
      // Re-running create has to converge on the declared password, the same
      // way the postgres DO block above does.
      { sql: `ALTER USER ${user} IDENTIFIED BY ${literal(tenant.password)};` },
      // Grants are per-database here, so isolation needs no explicit revoke:
      // a user with no grant on a schema cannot see it at all.
      { sql: `GRANT ALL PRIVILEGES ON ${dbName}.* TO ${user};` },
      { sql: `ALTER USER ${user} WITH MAX_USER_CONNECTIONS ${limit};` },
      { sql: `FLUSH PRIVILEGES;` },
    ];
  },

  dropStatements: (tenant) => [
    { sql: `DROP DATABASE IF EXISTS ${quoteBacktick(tenant.databaseName)};` },
    { sql: `DROP USER IF EXISTS ${literal(tenant.username)}@'%';` },
    { sql: `FLUSH PRIVILEGES;` },
  ],

  usageStatement: () =>
    `SELECT (SELECT COUNT(*) FROM information_schema.PROCESSLIST), @@max_connections;`,
  parseUsage: (stdout) => parseTwoNumbers(stdout),
};

// ── MongoDB ─────────────────────────────────────────────────────────────

export const mongodbTenancy: DatabaseTenancy = {
  adminCommand: (admin, statement) => ({
    argv: [
      "mongosh",
      "--quiet",
      "-u",
      admin.username,
      "-p",
      admin.password,
      "--authenticationDatabase",
      "admin",
      "--eval",
      statement,
    ],
    env: [],
  }),

  createStatements: (tenant) => {
    const dbRef = `db.getSiblingDB(${jsLiteral(tenant.databaseName)})`;
    // Mongo has no CREATE DATABASE: a database exists once something is
    // written to it, and the user record itself is that write. `dbOwner` on
    // exactly this database is the whole grant — it confers nothing anywhere
    // else, so tenants are isolated by construction.
    return [
      {
        sql: `(function () {
  const target = ${dbRef};
  const roles = [{ role: "dbOwner", db: ${jsLiteral(tenant.databaseName)} }];
  const exists = target.getUser(${jsLiteral(tenant.username)});
  if (exists) {
    target.updateUser(${jsLiteral(tenant.username)}, { pwd: ${jsLiteral(tenant.password)}, roles });
  } else {
    target.createUser({ user: ${jsLiteral(tenant.username)}, pwd: ${jsLiteral(tenant.password)}, roles });
  }
})();`,
      },
    ];
  },

  dropStatements: (tenant) => {
    const dbRef = `db.getSiblingDB(${jsLiteral(tenant.databaseName)})`;
    // User before database: dropDatabase removes the user record too, and
    // dropping it explicitly first keeps the credential dead even if the
    // second call fails.
    return [
      {
        sql: `(function () {
  const target = ${dbRef};
  if (target.getUser(${jsLiteral(tenant.username)})) target.dropUser(${jsLiteral(tenant.username)});
  target.dropDatabase();
})();`,
      },
    ];
  },

  usageStatement: () =>
    `(function () { const s = db.adminCommand({ serverStatus: 1 }); print(s.connections.current + " " + (s.connections.current + s.connections.available)); })();`,
  parseUsage: (stdout) => parseTwoNumbers(stdout),
};

/** Both numbers on one whitespace-separated line, which is what every
 *  `usageStatement` above prints. Returns null rather than guessing when the
 *  client printed something else (a warning banner, an empty result). */
function parseTwoNumbers(stdout: string): ConnectionUsage | null {
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)[\s|]+(\d+)\s*$/.exec(line);
    if (match?.[1] && match[2]) {
      return { used: Number(match[1]), max: Number(match[2]) };
    }
  }
  return null;
}

const TENANCY: Partial<Record<DatabaseEngine, DatabaseTenancy>> = {
  postgres: postgresTenancy,
  mariadb: mariadbTenancy,
  mongodb: mongodbTenancy,
};

/** The tenancy driver for an engine, or null when the engine cannot host
 *  isolated tenants (redis, clickhouse). */
export function getTenancy(engine: DatabaseEngine): DatabaseTenancy | null {
  return TENANCY[engine] ?? null;
}

/** Can this engine act as a shared server? */
export function engineSupportsHosting(engine: DatabaseEngine): boolean {
  return getTenancy(engine) !== null;
}
