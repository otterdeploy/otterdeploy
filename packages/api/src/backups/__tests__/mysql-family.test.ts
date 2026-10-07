/**
 * Every managed MariaDB backup exited 127 because MariaDB 11+ images ship
 * `mariadb-dump` and no `mysqldump`. The dump/restore commands probe for
 * the image's name of the tool; these run the real `sh -c` body against a
 * PATH holding only one name, the way each image does.
 */
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { dumpCommand, restoreCommand } from "../engine-helpers";

const creds = { engine: "mariadb" as const, databaseName: "app", username: "u", password: "p" };
let dir = "";

/** A bin dir holding stubs that print their own name and argv. */
async function binDir(name: string, tools: string[]): Promise<string> {
  const path = join(dir, name);
  await mkdir(path, { recursive: true });
  for (const tool of tools) {
    await writeFile(join(path, tool), `#!/bin/sh\necho ${tool} "$@"\n`);
    await chmod(join(path, tool), 0o755);
  }
  return path;
}

/** Run a `["sh", "-c", body]` command with PATH limited to `bin` (+ /bin for sh). */
function runIn(cmd: string[], bin: string): string {
  const [shell, flag, body] = cmd;
  if (shell !== "sh" || flag !== "-c" || body === undefined)
    throw new Error("not an sh -c command");
  const run = spawnSync("/bin/sh", ["-c", body], { env: { PATH: bin }, encoding: "utf8" });
  return `${run.stdout}`.trim();
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "mysql-family-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("MySQL-family dump/restore tool names", () => {
  it("a MariaDB 11+ image (mariadb-* names only) dumps with mariadb-dump", async () => {
    const bin = await binDir("mariadb11", ["mariadb-dump", "mariadb"]);
    expect(runIn(dumpCommand(creds).cmd, bin)).toBe("mariadb-dump -u u app");
    expect(runIn(restoreCommand(creds).cmd, bin)).toBe("mariadb -u u app");
  });

  it("a MySQL image (mysql* names only) dumps with mysqldump", async () => {
    const bin = await binDir("mysql8", ["mysqldump", "mysql"]);
    expect(runIn(dumpCommand(creds).cmd, bin)).toBe("mysqldump -u u app");
    expect(runIn(restoreCommand(creds).cmd, bin)).toBe("mysql -u u app");
  });

  it("an image with both names prefers the MariaDB one", async () => {
    const bin = await binDir("mariadb10", ["mariadb-dump", "mysqldump", "mariadb", "mysql"]);
    expect(runIn(dumpCommand(creds).cmd, bin)).toBe("mariadb-dump -u u app");
    expect(runIn(restoreCommand(creds).cmd, bin)).toBe("mariadb -u u app");
  });
});
