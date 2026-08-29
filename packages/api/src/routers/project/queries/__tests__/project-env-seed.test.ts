/**
 * od-esjx: `upsertProjectEnvVar({ onlyIfAbsent: true })` must SEED, never
 * replace.
 *
 * Project variables are one flat namespace shared by every stack in a
 * project, and template variable names are generic — a dozen templates each
 * want `POSTGRES_PASSWORD`. An unconditional write from one stack's install
 * therefore rotates a credential another stack is running on, and rotates a
 * reinstalled stack's own credential out from under its surviving data
 * volume. The second case is silent: Postgres ignores `POSTGRES_PASSWORD`
 * once its data directory exists, so every config surface shows the new
 * value while the database still holds the old one.
 *
 * Same fluent `@otterdeploy/db` mock as project-env-sealed.test.ts — no real
 * database, and the encrypt path is real so a seed-skip cannot be mistaken
 * for a write that happened to produce the same ciphertext.
 */
import { idSchema } from "@otterdeploy/shared/id";
import { describe, expect, test, vi } from "vite-plus/test";

function selectChain(rows: unknown[]) {
  const whereResult = Object.assign(Promise.resolve(rows), {
    limit: vi.fn(() => Promise.resolve(rows)),
  });
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => whereResult),
  };
  return chain;
}

function insertChain(returned: unknown[], capture: { values?: unknown }) {
  const chain = {
    values: vi.fn((v: unknown) => {
      capture.values = v;
      return chain;
    }),
    onConflictDoUpdate: vi.fn(() => chain),
    returning: vi.fn(() => Promise.resolve(returned)),
  };
  return chain;
}

interface FakeTx {
  select: (...args: unknown[]) => ReturnType<typeof selectChain>;
  insert: (...args: unknown[]) => ReturnType<typeof insertChain>;
}

let nextSelectRows: unknown[] = [];
let lastInsertCapture: { values?: unknown } = {};
let lastInsertReturn: unknown[] = [];
let insertCalls = 0;

function makeTx(): FakeTx {
  return {
    select: vi.fn(() => selectChain(nextSelectRows)),
    insert: vi.fn(() => {
      insertCalls++;
      lastInsertCapture = {};
      return insertChain(lastInsertReturn, lastInsertCapture);
    }),
  };
}

vi.mock("@otterdeploy/db", () => ({
  db: {
    transaction: vi.fn(async (cb: (tx: FakeTx) => unknown) => cb(makeTx())),
    select: vi.fn(() => selectChain(nextSelectRows)),
  },
}));

import { encryptForDomain } from "../../../../lib/crypto";
import { upsertProjectEnvVar } from "../project-env";

const scope = {
  projectId: idSchema.project.parse("prj_1"),
  environmentId: idSchema.environment.parse("env_1"),
};

function existingRow(value: string) {
  return {
    id: "pev_1",
    projectId: scope.projectId,
    environmentId: scope.environmentId,
    key: "POSTGRES_PASSWORD",
    value,
    isSecret: true,
    sealed: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

describe("upsertProjectEnvVar, seed semantics", () => {
  // THE regression. A second stack installing into the same project asks for
  // POSTGRES_PASSWORD; the value already in the bag is the one live databases
  // authenticate with, and it must survive.
  test("leaves an existing key alone and returns the stored value", async () => {
    const stored = "wscf-the-value-the-volume-actually-has";
    nextSelectRows = [existingRow(await encryptForDomain(stored, "env-vars"))];
    insertCalls = 0;

    const row = await upsertProjectEnvVar({
      scope,
      key: "POSTGRES_PASSWORD",
      value: "x2kZ-freshly-generated-by-the-new-install",
      isSecret: true,
      onlyIfAbsent: true,
    });

    expect(row.value).toBe(stored);
    expect(insertCalls, "seed must not write when the key exists").toBe(0);
  });

  test("writes when the key is absent", async () => {
    nextSelectRows = [];
    insertCalls = 0;
    lastInsertReturn = [existingRow(await encryptForDomain("brand-new", "env-vars"))];

    await upsertProjectEnvVar({
      scope,
      key: "POSTGRES_PASSWORD",
      value: "brand-new",
      isSecret: true,
      onlyIfAbsent: true,
    });

    expect(insertCalls).toBe(1);
  });

  // The default is unchanged: the variables editor and the API still replace.
  test("without the flag, an existing key is replaced as before", async () => {
    nextSelectRows = [existingRow(await encryptForDomain("old", "env-vars"))];
    insertCalls = 0;
    lastInsertReturn = [existingRow(await encryptForDomain("new", "env-vars"))];

    await upsertProjectEnvVar({
      scope,
      key: "POSTGRES_PASSWORD",
      value: "new",
      isSecret: true,
    });

    expect(insertCalls).toBe(1);
  });
});
