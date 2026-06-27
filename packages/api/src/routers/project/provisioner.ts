import { env } from "@otterdeploy/env/server";
import { SQL } from "bun";

function getProvisionerUrl() {
  return env.DATABASE_PROVISIONER_URL ?? env.DATABASE_URL;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

/**
 * Ensure a Postgres role and database exist with the given credentials.
 *
 * Runs against the provisioner connection (DATABASE_PROVISIONER_URL, falling
 * back to DATABASE_URL). Idempotent: if the role exists, its password is
 * reset; if the database exists, it's left alone.
 */
export async function ensurePostgresDatabase(input: {
  databaseName: string;
  username: string;
  password: string;
}) {
  const sql = new SQL(getProvisionerUrl());

  try {
    const roleRows = await sql`select 1 from pg_roles where rolname = ${input.username}`;
    if (roleRows.length === 0) {
      await sql.unsafe(`create role ${quoteIdentifier(input.username)} with login password $1`, [
        input.password,
      ]);
    } else {
      await sql.unsafe(`alter role ${quoteIdentifier(input.username)} with login password $1`, [
        input.password,
      ]);
    }

    const dbRows = await sql`select 1 from pg_database where datname = ${input.databaseName}`;
    if (dbRows.length === 0) {
      await sql.unsafe(
        `create database ${quoteIdentifier(input.databaseName)} owner ${quoteIdentifier(input.username)}`,
      );
    }
  } finally {
    await sql.close();
  }
}
