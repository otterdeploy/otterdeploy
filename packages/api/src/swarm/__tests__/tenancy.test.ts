/**
 * The SQL that carves a tenant out of a shared server.
 *
 * These statements run as a superuser inside someone's database container, so
 * what they assert is not "the string looks right" but the three properties
 * that make hosting safe: identifiers coming from operator-supplied names are
 * quoted, a second create converges instead of failing, and the isolation
 * grants are actually emitted (a tenant that can open a session against its
 * neighbour's database is the whole feature failing quietly).
 */
import { describe, expect, test } from "vite-plus/test";

import {
  engineSupportsHosting,
  getTenancy,
  mariadbTenancy,
  mongodbTenancy,
  postgresTenancy,
} from "../database-engines/tenancy";

const admin = { username: "acme_pg_user", password: "s3cret", databaseName: "acme_pg_db" };
const tenant = {
  databaseName: "acme_blog_db",
  username: "acme_blog_user",
  password: "hunter2",
  connectionLimit: 20,
};

describe("engine support", () => {
  test("only engines with per-database auth can host", () => {
    expect(engineSupportsHosting("postgres")).toBe(true);
    expect(engineSupportsHosting("mariadb")).toBe(true);
    expect(engineSupportsHosting("mongodb")).toBe(true);
    // Redis's numbered databases share one password: nothing to isolate.
    expect(engineSupportsHosting("redis")).toBe(false);
    expect(engineSupportsHosting("clickhouse")).toBe(false);
    expect(getTenancy("redis")).toBeNull();
  });
});

describe("postgres tenancy", () => {
  const sql = postgresTenancy.createStatements(tenant, admin).map((s) => s.sql);

  test("revokes PUBLIC's implicit CONNECT on the tenant AND the host database", () => {
    // Postgres grants CONNECT on every database to PUBLIC. Without both
    // revokes, every tenant role on the server can open a session against
    // every other database on it.
    expect(sql.some((s) => /REVOKE ALL ON DATABASE "acme_blog_db" FROM PUBLIC/.test(s))).toBe(true);
    expect(sql.some((s) => /REVOKE CONNECT ON DATABASE "acme_pg_db" FROM PUBLIC/.test(s))).toBe(
      true,
    );
  });

  test("grants the tenant its own database and applies the connection cap", () => {
    expect(
      sql.some((s) =>
        /GRANT ALL PRIVILEGES ON DATABASE "acme_blog_db" TO "acme_blog_user"/.test(s),
      ),
    ).toBe(true);
    expect(sql.some((s) => /CONNECTION LIMIT 20/.test(s))).toBe(true);
  });

  test("an uncapped tenant asks for -1, postgres's spelling of unlimited", () => {
    const uncapped = postgresTenancy
      .createStatements({ ...tenant, connectionLimit: null }, admin)
      .map((s) => s.sql);
    expect(uncapped.some((s) => /CONNECTION LIMIT -1/.test(s))).toBe(true);
  });

  test("a re-run converges: the role resets, the database is forgiven", () => {
    // Idempotence is not cosmetic here. A retried apply MUST NOT fail on the
    // objects its first attempt created, or the operator can never recover.
    const role = postgresTenancy.createStatements(tenant, admin)[0];
    expect(role?.sql).toMatch(/IF EXISTS \(SELECT FROM pg_roles/);
    expect(role?.sql).toMatch(/ALTER ROLE %I WITH LOGIN PASSWORD/);
    const create = postgresTenancy.createStatements(tenant, admin)[1];
    expect(create?.tolerate?.test("ERROR:  database ... already exists")).toBe(true);
    // And nothing else is forgiving: a permissions error still fails the plan.
    expect(create?.tolerate?.test("ERROR:  permission denied")).toBe(false);
  });

  test("drop terminates sessions before dropping, and reassigns before the role", () => {
    const dropped = postgresTenancy.dropStatements(tenant, admin).map((s) => s.sql);
    expect(dropped[0]).toMatch(/pg_terminate_backend/);
    expect(dropped[1]).toMatch(/DROP DATABASE IF EXISTS "acme_blog_db"/);
    expect(dropped[2]).toMatch(/REASSIGN OWNED BY/);
    expect(dropped[2]).toMatch(/DROP ROLE/);
  });

  test("quotes identifiers and escapes literals from operator-supplied names", () => {
    const nasty = postgresTenancy
      .createStatements(
        { databaseName: 'ev"il', username: "o'brien", password: "p'wd", connectionLimit: null },
        admin,
      )
      .map((s) => s.sql)
      .join("\n");
    expect(nasty).toContain('"ev""il"');
    expect(nasty).toContain("'o''brien'");
    expect(nasty).toContain("'p''wd'");
  });

  test("reads the connection budget as used + max", () => {
    expect(postgresTenancy.parseUsage("42 100\n")).toEqual({ used: 42, max: 100 });
    // A client that printed a banner instead of a row is unknown, not zero.
    expect(postgresTenancy.parseUsage("psql: warning\n")).toBeNull();
  });
});

describe("mariadb tenancy", () => {
  const sql = mariadbTenancy.createStatements(tenant, admin).map((s) => s.sql);

  test("scopes the grant to exactly one schema", () => {
    expect(sql.some((s) => s.includes("GRANT ALL PRIVILEGES ON `acme_blog_db`.* TO"))).toBe(true);
    expect(sql.some((s) => s.includes("ON *.*"))).toBe(false);
  });

  test("every statement is idempotent, and the password converges on re-run", () => {
    expect(sql[0]).toMatch(/CREATE DATABASE IF NOT EXISTS/);
    expect(sql[1]).toMatch(/CREATE USER IF NOT EXISTS/);
    expect(sql[2]).toMatch(/ALTER USER .* IDENTIFIED BY/);
    expect(sql.every((s) => !/DROP/.test(s))).toBe(true);
  });

  test("0 is MySQL's unlimited, so a null cap maps to it", () => {
    const uncapped = mariadbTenancy
      .createStatements({ ...tenant, connectionLimit: null }, admin)
      .map((s) => s.sql);
    expect(uncapped.some((s) => /MAX_USER_CONNECTIONS 0/.test(s))).toBe(true);
  });

  test("the password never reaches the process list", () => {
    const command = mariadbTenancy.adminCommand(admin, "SELECT 1");
    expect(command.argv.join(" ")).not.toContain(admin.password);
    expect(command.env).toContain(`MYSQL_PWD=${admin.password}`);
  });

  test("backtick-quotes identifiers", () => {
    const nasty = mariadbTenancy
      .createStatements({ databaseName: "ev`il", username: "o'brien", password: "p'wd" }, admin)
      .map((s) => s.sql)
      .join("\n");
    expect(nasty).toContain("`ev``il`");
    expect(nasty).toContain("'o''brien'");
  });
});

describe("mongodb tenancy", () => {
  test("grants dbOwner on exactly the tenant's database", () => {
    const [statement] = mongodbTenancy.createStatements(tenant, admin);
    expect(statement?.sql).toContain('{ role: "dbOwner", db: "acme_blog_db" }');
    expect(statement?.sql).toContain('db.getSiblingDB("acme_blog_db")');
  });

  test("updates an existing user instead of failing the create", () => {
    const [statement] = mongodbTenancy.createStatements(tenant, admin);
    expect(statement?.sql).toContain("updateUser");
    expect(statement?.sql).toContain("createUser");
  });

  test("drops the user before the database", () => {
    const [statement] = mongodbTenancy.dropStatements(tenant, admin);
    const dropUserAt = statement?.sql.indexOf("dropUser") ?? -1;
    const dropDbAt = statement?.sql.indexOf("dropDatabase") ?? -1;
    expect(dropUserAt).toBeGreaterThan(-1);
    expect(dropUserAt).toBeLessThan(dropDbAt);
  });

  test("escapes names into JS literals rather than concatenating them", () => {
    const [statement] = mongodbTenancy.createStatements(
      { databaseName: 'ev"il', username: "u", password: 'pa"ss' },
      admin,
    );
    expect(statement?.sql).toContain('"ev\\"il"');
    expect(statement?.sql).toContain('"pa\\"ss"');
  });
});

/**
 * The refusals.
 *
 * A shared server makes some previously-safe operations dangerous: they act on
 * the CONTAINER, and on a shared server the container is everyone's. These
 * pin that the guards exist and say why, because the failure mode they prevent
 * is silent — the operation succeeds, and the damage lands on a neighbouring
 * database whose owner never asked for anything.
 */
describe("hosted-database refusals", () => {
  test("a roll is refused, naming the database and the reason", async () => {
    const { HostedDatabaseNotRollableError } = await import("../../routers/project/errors");
    const error = new HostedDatabaseNotRollableError({ resourceId: "res_1", name: "blog" });
    expect(error.message).toContain("blog");
    expect(error.message).toContain("shared database server");
    // The operator needs to know the alternative, not just the refusal.
    expect(error.message).toMatch(/on the server itself/i);
  });

  test("publishing one database of a shared server is refused", async () => {
    const { HostedDatabaseNotPublishableError } = await import("../../routers/project/errors");
    const error = new HostedDatabaseNotPublishableError({ resourceId: "res_1", name: "blog" });
    expect(error.message).toContain("every database on that server");
  });

  test("deleting a server names the databases still on it", async () => {
    const { DatabaseHasTenantsError } = await import("../../routers/project/errors");
    const error = new DatabaseHasTenantsError({ resourceId: "res_1", tenants: ["blog", "shop"] });
    expect(error.message).toContain("blog, shop");
    expect(error.message).toContain("2 databases");
  });
});
