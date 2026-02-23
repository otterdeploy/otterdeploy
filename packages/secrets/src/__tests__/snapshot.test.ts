import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import {
  createSnapshotEntries,
  computeSnapshotHash,
} from "../snapshot";
import type { ResolvedEnvVar } from "../env-resolver";

function makeVar(overrides: Partial<ResolvedEnvVar> & { key: string; value: string }): ResolvedEnvVar {
  return {
    scope: "project",
    scopeId: "proj-1",
    isBuildTime: false,
    isSecret: false,
    variableId: `var-${overrides.key}`,
    ...overrides,
  };
}

describe("createSnapshotEntries", () => {
  it("creates entries with SHA-256 digests of the values", () => {
    const vars: ResolvedEnvVar[] = [
      makeVar({ key: "DB_URL", value: "postgres://localhost/db" }),
      makeVar({ key: "API_KEY", value: "sk-test-123" }),
    ];

    const entries = createSnapshotEntries(vars);

    expect(entries).toHaveLength(2);
    for (let i = 0; i < vars.length; i++) {
      const expected = crypto.createHash("sha256").update(vars[i].value).digest("hex");
      expect(entries[i].digest).toBe(expected);
      expect(entries[i].key).toBe(vars[i].key);
    }
  });
});

describe("computeSnapshotHash", () => {
  it("produces a consistent hash for the same entries", () => {
    const vars: ResolvedEnvVar[] = [
      makeVar({ key: "A", value: "val-a" }),
      makeVar({ key: "B", value: "val-b" }),
    ];
    const entries = createSnapshotEntries(vars);

    const hash1 = computeSnapshotHash(entries);
    const hash2 = computeSnapshotHash(entries);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it("produces different hashes when values differ", () => {
    const vars1: ResolvedEnvVar[] = [
      makeVar({ key: "SECRET", value: "alpha" }),
    ];
    const vars2: ResolvedEnvVar[] = [
      makeVar({ key: "SECRET", value: "beta" }),
    ];

    const hash1 = computeSnapshotHash(createSnapshotEntries(vars1));
    const hash2 = computeSnapshotHash(createSnapshotEntries(vars2));

    expect(hash1).not.toBe(hash2);
  });
});
