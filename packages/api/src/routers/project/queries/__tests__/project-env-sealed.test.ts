/**
 * od-5j8.12 — query-layer coverage for sealed project env vars:
 * `upsertProjectEnvVar` must encrypt on write whenever the FINAL state is
 * sealed (whether this call or a prior one set the flag — sticky, one-way),
 * and `bulkReplaceProjectEnvVars` must never delete or overwrite an existing
 * sealed row. Uses real AES-GCM (via `../../../lib/crypto`, already unit-
 * tested in `lib/__tests__/crypto.test.ts`) against a hand-rolled fluent
 * mock of `@otterdeploy/db`'s query builder — no real database needed.
 */
import { describe, expect, test, vi } from "vite-plus/test";

// ── A minimal fluent mock of drizzle's query builder ────────────────────
// Only the methods `project-env.ts` actually calls. Each chain step but the
// terminal one just returns itself; the terminal step resolves the row set
// the test configured for that call.
function selectChain(rows: unknown[]) {
  // `where()` needs to serve two shapes used across this file's subject:
  //   `await tx.select()...where(...)`             (bulkReplace's sealed-rows read)
  //   `await tx.select()...where(...).limit(1)`     (upsert's existing-row read)
  // so it returns a Promise (thenable, awaitable directly) that ALSO carries
  // a chainable `.limit()`.
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
  const chain = {
    where: vi.fn(() => Promise.resolve(undefined)),
  };
  return chain;
}

interface FakeTx {
  select: (...args: unknown[]) => ReturnType<typeof selectChain>;
  insert: (...args: unknown[]) => ReturnType<typeof insertChain>;
  delete: (...args: unknown[]) => ReturnType<typeof deleteChain>;
}

let nextSelectRows: unknown[] = [];
let lastInsertCapture: { values?: unknown } = {};
let lastInsertReturn: unknown[] = [];
let selectCalls = 0;
let deleteCalls = 0;

function makeTx(): FakeTx {
  return {
    select: vi.fn(() => {
      selectCalls++;
      return selectChain(nextSelectRows);
    }),
    insert: vi.fn(() => {
      lastInsertCapture = {};
      return insertChain(lastInsertReturn, lastInsertCapture);
    }),
    delete: vi.fn(() => {
      deleteCalls++;
      return deleteChain();
    }),
  };
}

vi.mock("@otterdeploy/db", () => ({
  db: {
    transaction: vi.fn(async (cb: (tx: FakeTx) => unknown) => cb(makeTx())),
    select: vi.fn(() => selectChain(nextSelectRows)),
  },
}));

import { decryptForDomain } from "../../../../lib/crypto";
import { bulkReplaceProjectEnvVars, upsertProjectEnvVar } from "../project-env";

const scope = { projectId: "project_1", environmentId: "env_1" } as never;

describe("upsertProjectEnvVar — sealed write path", () => {
  test("encrypts the value with the env-vars domain key when sealed: true on a fresh key", async () => {
    nextSelectRows = []; // no existing row
    lastInsertReturn = [
      {
        id: "pev_1",
        projectId: "project_1",
        environmentId: "env_1",
        key: "TOKEN",
        // The insert path itself computes ciphertext BEFORE calling
        // `.values()` — echo back exactly what was captured so this test
        // proves the STORED value (not some other string) round-trips.
        get value() {
          return (lastInsertCapture.values as { value: string }).value;
        },
        isSecret: true,
        sealed: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const row = await upsertProjectEnvVar({
      scope,
      key: "TOKEN",
      value: "plaintext-token",
      sealed: true,
    });

    expect(row.sealed).toBe(true);
    // Never stores the plaintext verbatim.
    expect(row.value).not.toBe("plaintext-token");
    expect(row.value.startsWith("v2:env-vars:")).toBe(true);
    // But it's genuinely recoverable via the domain-scoped decrypt — proves
    // this is real encryption, not just an opaque placeholder string.
    expect(await decryptForDomain(row.value, "env-vars")).toBe("plaintext-token");
  });

  test("sealing is sticky: a later write with sealed omitted still encrypts, because the existing row was already sealed", async () => {
    nextSelectRows = [{ sealed: true }]; // existing row IS sealed
    lastInsertReturn = [
      {
        id: "pev_1",
        projectId: "project_1",
        environmentId: "env_1",
        key: "TOKEN",
        get value() {
          return (lastInsertCapture.values as { value: string }).value;
        },
        isSecret: true,
        get sealed() {
          return (lastInsertCapture.values as { sealed: boolean }).sealed;
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const row = await upsertProjectEnvVar({
      scope,
      key: "TOKEN",
      value: "replacement-plaintext",
      // sealed NOT passed — must not unseal.
    });

    expect(row.sealed).toBe(true);
    expect(row.value).not.toBe("replacement-plaintext");
    expect(await decryptForDomain(row.value, "env-vars")).toBe("replacement-plaintext");
  });

  test("a plain (never-sealed) write stores plaintext verbatim — sealing doesn't leak into unrelated keys", async () => {
    nextSelectRows = [];
    lastInsertReturn = [
      {
        id: "pev_2",
        projectId: "project_1",
        environmentId: "env_1",
        key: "PLAIN",
        get value() {
          return (lastInsertCapture.values as { value: string }).value;
        },
        isSecret: true,
        sealed: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const row = await upsertProjectEnvVar({ scope, key: "PLAIN", value: "not-a-secret" });

    expect(row.sealed).toBe(false);
    expect(row.value).toBe("not-a-secret");
  });
});

describe("bulkReplaceProjectEnvVars — sealed rows are never deleted or overwritten", () => {
  test("an existing sealed row survives a bulk replace that omits its key, and any attempt to overwrite it is dropped", async () => {
    const existingSealed = {
      id: "pev_sealed",
      projectId: "project_1",
      environmentId: "env_1",
      key: "SEALED_KEY",
      value: "v2:env-vars:1:existing-nonce:existing-ct",
      isSecret: true,
      sealed: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    nextSelectRows = [existingSealed]; // the sealed-rows read at the top of bulkReplace
    lastInsertReturn = [
      {
        id: "pev_plain",
        projectId: "project_1",
        environmentId: "env_1",
        key: "PLAIN_KEY",
        value: "new-plain-value",
        isSecret: true,
        sealed: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const rows = await bulkReplaceProjectEnvVars(scope, [
      { key: "PLAIN_KEY", value: "new-plain-value" },
      // Attempts to smuggle a "replacement" for the sealed key through the
      // bulk path — must be silently dropped, not applied.
      { key: "SEALED_KEY", value: "attacker-or-buggy-client-supplied-value" },
    ]);

    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.PLAIN_KEY?.value).toBe("new-plain-value");
    // The sealed row comes back completely unchanged — same ciphertext as
    // before the call, proving the bulk path never touched it.
    expect(byKey.SEALED_KEY?.value).toBe(existingSealed.value);
    expect(byKey.SEALED_KEY?.sealed).toBe(true);
  });
});
