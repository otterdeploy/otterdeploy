/**
 * od-5j8.12: query-layer coverage for sealed SERVICE env vars, mirroring
 * `routers/project/queries/__tests__/project-env-sealed.test.ts`:
 * `upsertServiceEnvVar` encrypts on write whenever the FINAL state is sealed
 * (sticky, one-way), and `bulkReplaceServiceEnvVars` never deletes or
 * overwrites an existing sealed row. Real AES-GCM (already unit-tested in
 * `lib/__tests__/crypto.test.ts`) against a hand-rolled fluent mock of
 * `@otterdeploy/db`, no real database needed.
 */
import type { ResourceId } from "@otterdeploy/shared/id";

import { hasPrefix, ID_PREFIX } from "@otterdeploy/shared/id";
import { describe, expect, test, vi } from "vite-plus/test";
import * as z from "zod";

function selectChain(rows: unknown[]) {
  // `where()` serves two shapes used by the subject:
  //   `await tx.select()...where(...)`          (bulkReplace's sealed-rows read)
  //   `await tx.select()...where(...).limit(1)` (upsert's existing-row read)
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

function deleteChain() {
  return { where: vi.fn(() => Promise.resolve(undefined)) };
}

interface FakeTx {
  select: (...args: unknown[]) => ReturnType<typeof selectChain>;
  insert: (...args: unknown[]) => ReturnType<typeof insertChain>;
  delete: (...args: unknown[]) => ReturnType<typeof deleteChain>;
}

let nextSelectRows: unknown[] = [];
let lastInsertCapture: { values?: unknown } = {};
let lastInsertReturn: unknown[] = [];

function makeTx(): FakeTx {
  return {
    select: vi.fn(() => selectChain(nextSelectRows)),
    insert: vi.fn(() => {
      lastInsertCapture = {};
      return insertChain(lastInsertReturn, lastInsertCapture);
    }),
    delete: vi.fn(() => deleteChain()),
  };
}

vi.mock("@otterdeploy/db", () => ({
  db: {
    transaction: vi.fn(async (cb: (tx: FakeTx) => unknown) => cb(makeTx())),
    select: vi.fn(() => selectChain(nextSelectRows)),
  },
}));

import { decryptForDomain } from "../../../../lib/crypto";
import { bulkReplaceServiceEnvVars, upsertServiceEnvVar } from "../env";

/** Brand a fixture id through the real prefix guard (accepts the legacy `resource_` spelling). */
function resourceIdFixture(value: string): ResourceId {
  if (!hasPrefix(value, ID_PREFIX.resource))
    throw new Error(`not a resource id: ${value}`);
  return value;
}

const serviceResourceId = resourceIdFixture("resource_svc");

/** Read the captured insert payload through a schema instead of casting it. */
const capturedValue = () =>
  z.object({ value: z.string() }).parse(lastInsertCapture.values).value;
const capturedSealed = () =>
  z.object({ sealed: z.boolean() }).parse(lastInsertCapture.values).sealed;

describe("upsertServiceEnvVar, sealed write path", () => {
  test("encrypts with the env-vars domain key when sealed: true", async () => {
    nextSelectRows = [];
    lastInsertReturn = [
      {
        id: "sev_1",
        serviceResourceId,
        environmentId: null,
        previewId: null,
        key: "TOKEN",
        get value() {
          return capturedValue();
        },
        isSecret: false,
        sealed: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const row = await upsertServiceEnvVar({
      serviceResourceId,
      key: "TOKEN",
      value: "plaintext-token",
      sealed: true,
    });

    expect(row.sealed).toBe(true);
    expect(row.value).not.toBe("plaintext-token");
    expect(row.value.startsWith("v2:env-vars:")).toBe(true);
    expect(await decryptForDomain(row.value, "env-vars")).toBe(
      "plaintext-token",
    );
  });

  test("sealing is sticky across writes. Omitting `sealed` on a later call doesn't unseal", async () => {
    nextSelectRows = [{ sealed: true }];
    lastInsertReturn = [
      {
        id: "sev_1",
        serviceResourceId,
        environmentId: null,
        previewId: null,
        key: "TOKEN",
        get value() {
          return capturedValue();
        },
        isSecret: false,
        get sealed() {
          return capturedSealed();
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const row = await upsertServiceEnvVar({
      serviceResourceId,
      key: "TOKEN",
      value: "replacement-plaintext",
    });

    expect(row.sealed).toBe(true);
    expect(await decryptForDomain(row.value, "env-vars")).toBe(
      "replacement-plaintext",
    );
  });
});

describe("upsertServiceEnvVar, unsealed rows are encrypted at rest too (od-3pp7)", () => {
  test("stores ciphertext in the DB but echoes the caller's plaintext back", async () => {
    nextSelectRows = [];
    lastInsertReturn = [
      {
        id: "sev_1",
        serviceResourceId,
        environmentId: null,
        previewId: null,
        key: "DATABASE_URL",
        get value() {
          return capturedValue();
        },
        isSecret: false,
        sealed: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const row = await upsertServiceEnvVar({
      serviceResourceId,
      key: "DATABASE_URL",
      value: "postgres://user:pw@host/db",
    });

    // What hit the DB is a v2 env-vars envelope, never the plaintext…
    expect(capturedValue().startsWith("v2:env-vars:")).toBe(true);
    expect(capturedValue()).not.toContain("postgres://");
    expect(await decryptForDomain(capturedValue(), "env-vars")).toBe(
      "postgres://user:pw@host/db",
    );
    // …while the caller (and the UI it renders) gets the plaintext echo.
    expect(row.sealed).toBe(false);
    expect(row.value).toBe("postgres://user:pw@host/db");
  });
});

describe("bulkReplaceServiceEnvVars, sealed rows survive wholesale replace", () => {
  test("an existing sealed row is preserved verbatim; a smuggled overwrite for its key is dropped", async () => {
    const existingSealed = {
      id: "sev_sealed",
      serviceResourceId,
      environmentId: null,
      previewId: null,
      key: "SEALED_KEY",
      value: "v2:env-vars:1:existing-nonce:existing-ct",
      isSecret: false,
      sealed: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    nextSelectRows = [existingSealed];
    lastInsertReturn = [
      {
        id: "sev_plain",
        serviceResourceId,
        environmentId: null,
        previewId: null,
        key: "PLAIN_KEY",
        value: "new-plain-value",
        isSecret: false,
        sealed: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const rows = await bulkReplaceServiceEnvVars(serviceResourceId, [
      { key: "PLAIN_KEY", value: "new-plain-value" },
      { key: "SEALED_KEY", value: "attacker-or-buggy-client-supplied-value" },
    ]);

    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.PLAIN_KEY?.value).toBe("new-plain-value");
    expect(byKey.SEALED_KEY?.value).toBe(existingSealed.value);
    expect(byKey.SEALED_KEY?.sealed).toBe(true);
  });
});
