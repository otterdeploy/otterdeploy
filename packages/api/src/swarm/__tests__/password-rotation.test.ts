/**
 * The statements that change a managed database's password on the
 * running engine.
 *
 * These run as a superuser inside the database's container, so what they
 * assert is the part a wrong plan would get silently wrong: the new password
 * is quoted (it is a literal inside SQL / a JS string), the login is the one
 * that still holds the right to make the change (the HOST's admin for a
 * tenant, root for a dedicated MariaDB), MariaDB's root (which shares the
 * password) is rotated with the app user, and engines that cannot change in
 * place get no plan instead of a half-rotation.
 */
import { describe, expect, test } from "vite-plus/test";

import {
  isRotatableEngine,
  passwordRotationPlan,
  postgresEndSessionsStatement,
} from "../database-engines/password-rotation";

const identity = { username: "acme_db_user", databaseName: "acme_db_db", password: "old-pass" };
const host = { username: "host_admin", password: "host-pass", databaseName: "host_db" };

function sqlOf(plan: ReturnType<typeof passwordRotationPlan>): string {
  return plan.statements.map((s) => s.sql).join("\n");
}

describe("which engines rotate in place", () => {
  test("postgres, mariadb and mongodb rotate; redis and clickhouse get no plan", () => {
    expect(isRotatableEngine("postgres")).toBe(true);
    expect(isRotatableEngine("mariadb")).toBe(true);
    expect(isRotatableEngine("mongodb")).toBe(true);
    // Redis bakes its password into the container command + healthcheck.
    expect(isRotatableEngine("redis")).toBe(false);
    expect(isRotatableEngine("clickhouse")).toBe(false);
  });
});

describe("postgres", () => {
  test("a dedicated database alters its own role, logged in with the current password", () => {
    const plan = passwordRotationPlan({
      engine: "postgres",
      identity,
      nextPassword: "NEW-pass_1",
      host: null,
    });
    expect(plan.login).toEqual(identity);
    expect(sqlOf(plan)).toBe(`ALTER ROLE "acme_db_user" WITH PASSWORD 'NEW-pass_1';`);
  });

  test("a tenant is altered by its host's admin", () => {
    const plan = passwordRotationPlan({ engine: "postgres", identity, nextPassword: "n", host });
    expect(plan.login).toEqual(host);
    expect(sqlOf(plan)).toContain(`ALTER ROLE "acme_db_user"`);
  });

  test("quotes in the role name and the password cannot break out of the statement", () => {
    const plan = passwordRotationPlan({
      engine: "postgres",
      identity: { ...identity, username: 'we"ird' },
      nextPassword: "it's; DROP ROLE x; --",
      host: null,
    });
    expect(sqlOf(plan)).toBe(`ALTER ROLE "we""ird" WITH PASSWORD 'it''s; DROP ROLE x; --';`);
  });

  test("the session cut-off ends only the role's sessions older than the change", () => {
    const sql = postgresEndSessionsStatement("acme_db_user", "2026-10-09 10:00:00+00").sql;
    expect(sql).toContain(`usename = 'acme_db_user'`);
    expect(sql).toContain(`backend_start < '2026-10-09 10:00:00+00'::timestamptz`);
    // Never the session running the statement.
    expect(sql).toContain("pid <> pg_backend_pid()");
  });
});

describe("mariadb", () => {
  test("a dedicated server rotates the app user AND root, logged in as root", () => {
    const plan = passwordRotationPlan({
      engine: "mariadb",
      identity,
      nextPassword: "NEW",
      host: null,
    });
    // The image sets MARIADB_ROOT_PASSWORD to the same value: root left alone
    // would keep the old password working as a superuser.
    expect(plan.login).toEqual({
      username: "root",
      password: "old-pass",
      databaseName: "acme_db_db",
    });
    const sql = sqlOf(plan);
    expect(sql).toContain(`ALTER USER 'acme_db_user'@'%' IDENTIFIED BY 'NEW';`);
    expect(sql).toContain(`ALTER USER IF EXISTS 'root'@'%' IDENTIFIED BY 'NEW';`);
    expect(sql).toContain(`ALTER USER IF EXISTS 'root'@'localhost' IDENTIFIED BY 'NEW';`);
    // One exec: the root session that authenticated with the old password
    // finishes the whole batch.
    expect(plan.statements).toHaveLength(1);
  });

  test("a tenant rotates only its own user, as the host admin", () => {
    const plan = passwordRotationPlan({ engine: "mariadb", identity, nextPassword: "N", host });
    expect(plan.login).toEqual(host);
    expect(sqlOf(plan)).not.toContain("root");
    expect(sqlOf(plan)).toContain(`ALTER USER 'acme_db_user'@'%' IDENTIFIED BY 'N';`);
  });
});

describe("mongodb", () => {
  test("a dedicated server's root user lives in admin", () => {
    const plan = passwordRotationPlan({
      engine: "mongodb",
      identity,
      nextPassword: "N",
      host: null,
    });
    expect(plan.login).toEqual(identity);
    expect(sqlOf(plan)).toBe(`db.getSiblingDB("admin").changeUserPassword("acme_db_user", "N");`);
  });

  test("a tenant's user lives in the tenant's own database; quotes stay inside the string", () => {
    const plan = passwordRotationPlan({
      engine: "mongodb",
      identity,
      nextPassword: 'a"); db.dropDatabase(); ("',
      host,
    });
    expect(plan.login).toEqual(host);
    expect(sqlOf(plan)).toBe(
      `db.getSiblingDB("acme_db_db").changeUserPassword("acme_db_user", "a\\"); db.dropDatabase(); (\\"");`,
    );
  });
});
