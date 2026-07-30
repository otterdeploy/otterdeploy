import { describe, expect, test } from "vite-plus/test";

import { dumpCommand } from "../engine-helpers";

const target = {
  databaseName: "shop",
  username: "app",
  password: "s3cret",
};

describe("dumpCommand — mariadb", () => {
  const { cmd, env, ext, method } = dumpCommand({ ...target, engine: "mariadb" });
  const script = cmd[2] ?? "";

  test("prefers mariadb-dump, which is the only dumper in mariadb:11+ images", () => {
    expect(cmd[0]).toBe("sh");
    expect(script).toContain("command -v mariadb-dump");
    expect(script.indexOf("mariadb-dump")).toBeLessThan(script.indexOf("mysqldump"));
    expect(method).toBe("mariadb-dump | gzip");
  });

  test("still falls back to mysqldump for genuine mysql:* images", () => {
    expect(script).toContain("exec mysqldump -u 'app' 'shop'");
  });

  test("the password goes through the env, never argv", () => {
    expect(env).toEqual(["MYSQL_PWD=s3cret"]);
    expect(script).not.toContain("s3cret");
    expect(ext).toBe("sql.gz");
  });

  test("identifiers are shell-quoted", () => {
    const odd = dumpCommand({ ...target, engine: "mariadb", databaseName: "sh'op" });
    expect(odd.cmd[2]).toContain(`'sh'\\''op'`);
  });
});

describe("dumpCommand — unsupported engines fail loudly", () => {
  test("redis has no logical dump", () => {
    expect(() => dumpCommand({ ...target, engine: "redis" })).toThrow(/volume backup/);
  });

  test("clickhouse has no dump path here", () => {
    expect(() => dumpCommand({ ...target, engine: "clickhouse" })).toThrow(/not supported/);
  });
});
