/**
 * The upgrade path of migration 20261006191815_global_project_slugs, which
 * makes project slugs unique across ALL organizations.
 *
 * An existing install can already hold the same slug in two orgs. The
 * migration keeps the slug on one holder (one with resources first, then the
 * oldest), renames every other holder that has NO resources (no runtime
 * objects, so nothing on the swarm moves), and refuses, rolling everything
 * back, when two or more holders have resources. Each case builds its own
 * database at the revision just before the migration, seeds it, then applies
 * the full migration set on top with drizzle's migrator, exactly as server
 * boot does.
 */
import { Result } from "better-result";
import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vite-plus/test";
import * as z from "zod";

const MIGRATION = "20261006191815_global_project_slugs";
const MIGRATIONS_DIR = fileURLToPath(new URL("../../../../../db/src/migrations", import.meta.url));

const slugRows = z.tuple([z.object({ slug: z.string() })]);
const countRows = z.tuple([z.object({ n: z.number() })]);

const short = () => randomUUID().replace(/-/g, "").slice(0, 12);

/** The server the suite's global setup was pointed at (see
 *  vitest.postgres.setup.ts, which refuses to start without it). */
function adminUrl(): string {
  /* oxlint-disable-next-line node/no-process-env -- test env boundary: the disposable server the postgres suite runs against */
  const url = process.env.INTEGRATION_POSTGRES_URL;
  if (!url) throw new Error("INTEGRATION_POSTGRES_URL is not set");
  return url;
}

/** Every migration folder strictly before `name`, copied verbatim into a temp
 *  dir. drizzle's migrator tracks applied migrations by folder name, so the
 *  full directory applied afterwards resumes exactly where this one stopped. */
function migrationsBefore(name: string): string {
  const all = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  const cutoff = all.indexOf(name);
  if (cutoff === -1) throw new Error(`migration folder ${name} not found`);
  const dir = mkdtempSync(join(tmpdir(), "otterdeploy-migrations-"));
  for (const folder of all.slice(0, cutoff)) {
    cpSync(join(MIGRATIONS_DIR, folder), join(dir, folder), { recursive: true });
  }
  return dir;
}

async function applyMigrations(url: string, migrationsFolder: string): Promise<void> {
  const client = new SQL({ url, max: 1 });
  try {
    await migrate(drizzle({ client }), { migrationsFolder });
  } finally {
    await client.close();
  }
}

describe("global project slug migration on an existing install", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  /** A database migrated up to just before the global-slug migration. */
  async function legacyInstall(): Promise<{ sql: SQL; url: string }> {
    const name = `slug_upgrade_${short()}`;
    const admin = new SQL({ url: adminUrl(), max: 1 });
    await admin.unsafe(`CREATE DATABASE "${name}"`);
    await admin.close();
    cleanups.push(async () => {
      const drop = new SQL({ url: adminUrl(), max: 1 });
      await drop.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await drop.close();
    });
    const url = new URL(adminUrl());
    url.pathname = `/${name}`;

    const before = migrationsBefore(MIGRATION);
    cleanups.push(() => rmSync(before, { recursive: true, force: true }));
    await applyMigrations(url.toString(), before);

    const sql = new SQL({ url: url.toString(), max: 2 });
    cleanups.push(() => sql.close());
    return { sql, url: url.toString() };
  }

  async function seedOrg(sql: SQL): Promise<string> {
    const id = `org_${short()}`;
    await sql`insert into "organization" (id, name, slug, created_at) values (${id}, ${id}, ${id}, now())`;
    return id;
  }

  async function seedProject(
    sql: SQL,
    input: { org: string; slug: string; daysAgo: number; withResource: boolean },
  ): Promise<string> {
    const id = `prj_${short()}`;
    await sql`
      insert into "project" (id, organization_id, name, slug, created_at, updated_at)
      values (${id}, ${input.org}, ${input.slug}, ${input.slug},
              now() - make_interval(days => ${input.daysAgo}), now() - make_interval(days => ${input.daysAgo}))
    `;
    if (input.withResource) {
      await sql`insert into "resource" (id, project_id, name, type) values (${`res_${short()}`}, ${id}, 'api', 'service')`;
    }
    return id;
  }

  const slugOf = async (sql: SQL, id: string): Promise<string> => {
    const rows: unknown = await sql`select slug from "project" where id = ${id}`;
    return slugRows.parse(rows)[0].slug;
  };

  it("renames the holders without resources and keeps the slug on the one with resources", async () => {
    const { sql, url } = await legacyInstall();
    const slug = `shop-${short()}`;
    // The OLDEST holder is empty and the newer one is running: the running
    // one keeps the slug, because renaming it would move its runtime objects.
    const emptyOlder = await seedProject(sql, {
      org: await seedOrg(sql),
      slug,
      daysAgo: 10,
      withResource: false,
    });
    const running = await seedProject(sql, {
      org: await seedOrg(sql),
      slug,
      daysAgo: 5,
      withResource: true,
    });
    const emptyNewer = await seedProject(sql, {
      org: await seedOrg(sql),
      slug,
      daysAgo: 1,
      withResource: false,
    });
    // Two empty holders: the older keeps it, the newer is renamed.
    const other = `blog-${short()}`;
    const blogOld = await seedProject(sql, {
      org: await seedOrg(sql),
      slug: other,
      daysAgo: 3,
      withResource: false,
    });
    const blogNew = await seedProject(sql, {
      org: await seedOrg(sql),
      slug: other,
      daysAgo: 2,
      withResource: false,
    });

    await applyMigrations(url, MIGRATIONS_DIR);

    expect(await slugOf(sql, running)).toBe(slug);
    expect(await slugOf(sql, emptyOlder)).toBe(`${slug}-${emptyOlder.slice(-6)}`);
    expect(await slugOf(sql, emptyNewer)).toBe(`${slug}-${emptyNewer.slice(-6)}`);
    expect(await slugOf(sql, blogOld)).toBe(other);
    expect(await slugOf(sql, blogNew)).toBe(`${other}-${blogNew.slice(-6)}`);

    // And from here on the database itself refuses a cross-org duplicate.
    const third = await seedOrg(sql);
    const duplicate = await Result.tryPromise({
      try: () =>
        sql`insert into "project" (id, organization_id, name, slug) values (${`prj_${short()}`}, ${third}, 'x', ${slug})`,
      catch: (cause) => cause,
    });
    expect(duplicate.isErr()).toBe(true);
  }, 90_000);

  it("refuses, changing nothing, when two holders of a slug both have resources", async () => {
    const { sql, url } = await legacyInstall();
    const slug = `shop-${short()}`;
    const first = await seedProject(sql, {
      org: await seedOrg(sql),
      slug,
      daysAgo: 5,
      withResource: true,
    });
    const second = await seedProject(sql, {
      org: await seedOrg(sql),
      slug,
      daysAgo: 1,
      withResource: true,
    });
    // A renamable duplicate elsewhere must be rolled back with the refusal.
    const other = `blog-${short()}`;
    await seedProject(sql, {
      org: await seedOrg(sql),
      slug: other,
      daysAgo: 3,
      withResource: false,
    });
    const blogNew = await seedProject(sql, {
      org: await seedOrg(sql),
      slug: other,
      daysAgo: 2,
      withResource: false,
    });

    const applied = await Result.tryPromise({
      try: () => applyMigrations(url, MIGRATIONS_DIR),
      catch: (cause) => cause,
    });

    expect(applied.isErr()).toBe(true);
    const failure = applied.isErr() ? applied.error : null;
    expect(failure).toBeInstanceOf(Error);
    const text = failure instanceof Error ? `${failure.message} ${String(failure.cause)}` : "";
    expect(text).toContain("global_project_slugs refused");
    expect(text).toContain(first);
    expect(text).toContain(second);

    expect(await slugOf(sql, first)).toBe(slug);
    expect(await slugOf(sql, second)).toBe(slug);
    expect(await slugOf(sql, blogNew)).toBe(other);
    const indexRows: unknown =
      await sql`select count(*)::int as n from pg_indexes where indexname = 'project_slug_unique'`;
    expect(countRows.parse(indexRows)[0].n).toBe(0);
  }, 90_000);
});
