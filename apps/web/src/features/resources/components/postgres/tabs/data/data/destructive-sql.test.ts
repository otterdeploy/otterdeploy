import { describe, expect, it } from "vitest";

import { classifyWriteSql } from "./destructive-sql";

describe("classifyWriteSql", () => {
  it("flags DROP and TRUNCATE", () => {
    expect(classifyWriteSql("DROP TABLE users")).toBe("destructive");
    expect(classifyWriteSql("drop schema public cascade;")).toBe("destructive");
    expect(classifyWriteSql("TRUNCATE orders")).toBe("destructive");
  });

  it("flags DELETE / UPDATE without a WHERE clause", () => {
    expect(classifyWriteSql("DELETE FROM users")).toBe("destructive");
    expect(classifyWriteSql("update users set active = false")).toBe("destructive");
  });

  it("treats scoped DELETE / UPDATE as a normal write", () => {
    expect(classifyWriteSql("DELETE FROM users WHERE id = 1")).toBe("write");
    expect(classifyWriteSql("UPDATE users SET active = false WHERE id = 1")).toBe("write");
  });

  it("treats INSERT and DDL-free writes as normal writes", () => {
    expect(classifyWriteSql("INSERT INTO users (name) VALUES ('otter')")).toBe("write");
    expect(classifyWriteSql("ALTER TABLE users ADD COLUMN bio text")).toBe("write");
  });

  it("ignores keywords inside string literals", () => {
    expect(classifyWriteSql("INSERT INTO notes (body) VALUES ('please DROP TABLE x')")).toBe(
      "write",
    );
    expect(classifyWriteSql("INSERT INTO notes (body) VALUES ('DELETE FROM everything')")).toBe(
      "write",
    );
  });

  it("ignores keywords inside comments", () => {
    expect(classifyWriteSql("-- drop table users\nINSERT INTO t VALUES (1)")).toBe("write");
    expect(classifyWriteSql("/* TRUNCATE t */ UPDATE t SET a = 1 WHERE id = 2")).toBe("write");
  });

  it("flags a multi-statement buffer when any statement is destructive", () => {
    expect(classifyWriteSql("INSERT INTO t VALUES (1); DROP TABLE t;")).toBe("destructive");
    expect(classifyWriteSql("INSERT INTO t VALUES (1); DELETE FROM t WHERE id = 1;")).toBe("write");
  });

  it("does not let a WHERE in a later statement excuse an earlier unscoped DELETE", () => {
    expect(classifyWriteSql("DELETE FROM a; SELECT 1 WHERE true;")).toBe("destructive");
  });
});
