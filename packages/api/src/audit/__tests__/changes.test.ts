import { describe, expect, test } from "vite-plus/test";

import type { AuditDraft } from "../changes";

import { recordAuditChanges, recordSecretMapChanges } from "../changes";

function draftContext(): { auditDraft: AuditDraft } {
  return { auditDraft: {} };
}

describe("recordAuditChanges", () => {
  test("records a patch of what actually changed", () => {
    const ctx = draftContext();
    recordAuditChanges(ctx, {
      before: { replicas: 1, healthCheck: { path: "/health" } },
      after: { replicas: 3, healthCheck: { path: "/health" } },
    });
    const patch = (ctx.auditDraft.changes as { patch: Array<{ path: string; op: string }> }).patch;
    expect(patch).toHaveLength(1);
    expect(patch[0]).toMatchObject({ op: "replace", path: "/replicas" });
  });

  // The column stays null rather than carrying `{patch: []}`, so "no diff
  // recorded" and "diff recorded, nothing changed" are not confusable in the UI.
  test("leaves the draft empty when nothing changed", () => {
    const ctx = draftContext();
    recordAuditChanges(ctx, { before: { replicas: 1 }, after: { replicas: 1 } });
    expect(ctx.auditDraft.changes).toBeUndefined();
  });

  // A handler calling this outside the oRPC middleware (background job, test)
  // must not throw. Auditing is never allowed to break the operation.
  test("is a no-op without a draft", () => {
    const ctx: { auditDraft?: AuditDraft } = {};
    expect(() => recordAuditChanges(ctx, { before: { a: 1 }, after: { a: 2 } })).not.toThrow();
  });

  test("redacts secret-shaped keys but still reports that they changed", () => {
    const ctx = draftContext();
    recordAuditChanges(ctx, {
      before: { name: "api", env: { DATABASE_URL: { value: "postgres://old" } } },
      after: { name: "api", env: { DATABASE_URL: { value: "postgres://new" } } },
    });
    const serialized = JSON.stringify(ctx.auditDraft.changes);
    expect(serialized).not.toContain("postgres://old");
    expect(serialized).not.toContain("postgres://new");
    expect(serialized).toContain("DATABASE_URL");
  });

  test("snapshots are omitted unless asked for", () => {
    const ctx = draftContext();
    recordAuditChanges(ctx, { before: { replicas: 1 }, after: { replicas: 2 } });
    const changes = ctx.auditDraft.changes as { before?: unknown; after?: unknown };
    expect(changes.before).toBeUndefined();
    expect(changes.after).toBeUndefined();
  });
});

describe("recordSecretMapChanges", () => {
  test("reports added, removed and rotated keys without any value", () => {
    const ctx = draftContext();
    recordSecretMapChanges(ctx, {
      before: { KEEP: "same", ROTATE: "old-secret", DROP: "gone-secret" },
      after: { KEEP: "same", ROTATE: "new-secret", ADD: "fresh-secret" },
    });
    const patch = (ctx.auditDraft.changes as { patch: Array<{ path: string; op: string }> }).patch;
    expect(patch).toEqual([
      { op: "add", path: "/ADD" },
      { op: "remove", path: "/DROP" },
      { op: "replace", path: "/ROTATE" },
    ]);
    const serialized = JSON.stringify(ctx.auditDraft.changes);
    for (const secret of ["old-secret", "new-secret", "gone-secret", "fresh-secret", "same"]) {
      expect(serialized).not.toContain(secret);
    }
  });

  // The regression this guards: reducing each side to a presence marker
  // independently makes a rotated value look unchanged, which silently drops the
  // single most audit-worthy env-var event.
  test("a rotation is not diffed away as unchanged", () => {
    const ctx = draftContext();
    recordSecretMapChanges(ctx, {
      before: { API_TOKEN: "aaa" },
      after: { API_TOKEN: "bbb" },
    });
    const patch = (ctx.auditDraft.changes as { patch: Array<{ path: string; op: string }> }).patch;
    expect(patch).toEqual([{ op: "replace", path: "/API_TOKEN" }]);
  });

  test("an untouched map records nothing", () => {
    const ctx = draftContext();
    recordSecretMapChanges(ctx, { before: { A: "1" }, after: { A: "1" } });
    expect(ctx.auditDraft.changes).toBeUndefined();
  });

  test("key order does not change the recorded patch", () => {
    const first = draftContext();
    const second = draftContext();
    recordSecretMapChanges(first, { before: {}, after: { B: "x", A: "y" } });
    recordSecretMapChanges(second, { before: {}, after: { A: "y", B: "x" } });
    expect(first.auditDraft.changes).toEqual(second.auditDraft.changes);
  });
});
