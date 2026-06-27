import { describe, expect, test } from "bun:test";

import { DATABASE_ENGINES, getDatabaseEngine, type DatabaseEngine } from "../database-engines";

describe("DATABASE_ENGINES", () => {
  test("includes postgres", () => {
    expect(DATABASE_ENGINES.postgres).toBeDefined();
    expect(DATABASE_ENGINES.postgres.label).toBe("PostgreSQL");
    expect(DATABASE_ENGINES.postgres.defaultPort).toBe(5432);
  });

  test("getDatabaseEngine returns metadata for a known engine", () => {
    const meta = getDatabaseEngine("postgres" satisfies DatabaseEngine);
    expect(meta.dockerImage).toBe("postgres");
  });

  test("every engine has the required metadata shape", () => {
    for (const [key, meta] of Object.entries(DATABASE_ENGINES)) {
      expect(meta.label, `${key}.label`).toBeTypeOf("string");
      expect(meta.defaultPort, `${key}.defaultPort`).toBeTypeOf("number");
      expect(meta.dockerImage, `${key}.dockerImage`).toBeTypeOf("string");
      expect(Array.isArray(meta.versions), `${key}.versions is array`).toBe(true);
    }
  });
});
