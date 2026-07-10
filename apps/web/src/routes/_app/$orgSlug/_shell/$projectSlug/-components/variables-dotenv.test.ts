import { describe, expect, it } from "vite-plus/test";

import { parseDotEnv, serializeDotEnv } from "./variables-dotenv";

describe("serializeDotEnv", () => {
  it("writes KEY=VALUE lines in input order with a trailing newline", () => {
    const out = serializeDotEnv([
      { key: "Z_LAST", value: "1" },
      { key: "A_FIRST", value: "2" },
    ]);
    expect(out).toBe("Z_LAST=1\nA_FIRST=2\n");
  });

  it("returns an empty string for no vars", () => {
    expect(serializeDotEnv([])).toBe("");
  });

  it("leaves empty values bare", () => {
    expect(serializeDotEnv([{ key: "EMPTY", value: "" }])).toBe("EMPTY=\n");
  });

  it("quotes values containing spaces", () => {
    expect(serializeDotEnv([{ key: "MSG", value: "hello world" }])).toBe(
      'MSG="hello world"\n',
    );
  });

  it("quotes and escapes newlines, quotes and backslashes", () => {
    expect(serializeDotEnv([{ key: "PEM", value: 'a\nb"c\\d' }])).toBe(
      'PEM="a\\nb\\"c\\\\d"\n',
    );
  });

  it("does not quote plain connection strings", () => {
    const dsn = "postgres://user:pw@host:5432/db?sslmode=require";
    expect(serializeDotEnv([{ key: "DATABASE_URL", value: dsn }])).toBe(
      `DATABASE_URL=${dsn}\n`,
    );
  });

  it("round-trips single-line values through parseDotEnv", () => {
    const vars = [
      { key: "DATABASE_URL", value: "postgres://u:p@h:5432/db" },
      { key: "GREETING", value: "hello world" },
      { key: "EMPTY", value: "" },
    ];
    const parsed = parseDotEnv(serializeDotEnv(vars));
    expect(parsed.map(({ key, value }) => ({ key, value }))).toEqual(vars);
  });
});

describe("parseDotEnv", () => {
  it("skips comments and blank lines, strips quotes and export prefix", () => {
    const parsed = parseDotEnv(
      '# comment\n\nexport API_TOKEN="abc"\nPLAIN=1\n',
    );
    expect(parsed).toEqual([
      { key: "API_TOKEN", value: "abc", isSecret: true },
      { key: "PLAIN", value: "1", isSecret: false },
    ]);
  });

  it("marks secret-looking keys", () => {
    const parsed = parseDotEnv("DB_PASSWORD=x\nPUBLIC_URL=y");
    expect(parsed.map((p) => p.isSecret)).toEqual([true, false]);
  });
});
