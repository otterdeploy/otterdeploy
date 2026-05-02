import { Client } from "pg";

import { env } from "@otterstack/env/server";

function getProvisionerUrl() {
  return env.DATABASE_PROVISIONER_URL ?? env.DATABASE_URL;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export async function ensurePostgresDatabase(input: {
  databaseName: string;
  username: string;
  password: string;
}) {
  const client = new Client({
    connectionString: getProvisionerUrl(),
  });

  await client.connect();

  try {
    const roleExists = await client.query("select 1 from pg_roles where rolname = $1", [input.username]);
    if (roleExists.rowCount === 0) {
      await client.query(
        `create role ${quoteIdentifier(input.username)} with login password $1`,
        [input.password],
      );
    } else {
      await client.query(`alter role ${quoteIdentifier(input.username)} with login password $1`, [
        input.password,
      ]);
    }

    const databaseExists = await client.query("select 1 from pg_database where datname = $1", [
      input.databaseName,
    ]);
    if (databaseExists.rowCount === 0) {
      await client.query(
        `create database ${quoteIdentifier(input.databaseName)} owner ${quoteIdentifier(input.username)}`,
      );
    }
  } finally {
    await client.end();
  }
}
