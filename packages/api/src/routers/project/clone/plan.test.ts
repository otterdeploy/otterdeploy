import { describe, expect, test } from "vite-plus/test";

import { cloneName, planClone, rewriteRefs, type CloneSource } from "./plan";

const svc = (resourceId: string, name: string): CloneSource => ({
  resourceId,
  name,
  type: "service",
});

describe("cloneName", () => {
  test("appends -copy when free", () => {
    expect(cloneName("api", new Set())).toBe("api-copy");
  });

  test("counts up when the copy name is taken", () => {
    expect(cloneName("api", new Set(["api-copy"]))).toBe("api-copy-2");
    expect(cloneName("api", new Set(["api-copy", "api-copy-2"]))).toBe("api-copy-3");
  });

  test("does not stutter when cloning a clone", () => {
    // "api-copy-copy" reads as nonsense; the second copy of api is what it is.
    expect(cloneName("api-copy", new Set(["api-copy"]))).toBe("api-copy-2");
    expect(cloneName("api-copy-3", new Set(["api-copy"]))).toBe("api-copy-2");
  });

  test("stays within the name bound", () => {
    const long = "a".repeat(80);
    expect(cloneName(long, new Set()).length).toBeLessThanOrEqual(60);
  });

  test("respects names reserved earlier in the same plan", () => {
    // Without this, cloning two resources at once assigns both the same name
    // and the second insert dies on the unique index.
    expect(cloneName("api", new Set(["api-copy"]))).not.toBe("api-copy");
  });
});

describe("rewriteRefs", () => {
  const rename = new Map([["db", "db-copy"]]);

  test("repoints a ref whose target is in the set", () => {
    // The whole point: otherwise the cloned service writes to production.
    expect(rewriteRefs("${{db.DATABASE_URL}}", rename).value).toBe("${{db-copy.DATABASE_URL}}");
  });

  test("leaves a ref pointing outside the set alone, and reports it", () => {
    const out = rewriteRefs("${{redis.REDIS_URL}}", rename);
    expect(out.value).toBe("${{redis.REDIS_URL}}");
    expect(out.external).toEqual(["redis"]);
  });

  test("preserves surrounding literal text", () => {
    expect(rewriteRefs("postgres://${{db.HOST}}:5432/app", rename).value).toBe(
      "postgres://${{db-copy.HOST}}:5432/app",
    );
  });

  test("handles several refs in one value", () => {
    const r = new Map([
      ["db", "db-copy"],
      ["cache", "cache-copy"],
    ]);
    expect(rewriteRefs("${{db.HOST}}|${{cache.HOST}}", r).value).toBe(
      "${{db-copy.HOST}}|${{cache-copy.HOST}}",
    );
  });

  test("keeps an escaped ref escaped", () => {
    // The parser unescapes into a literal; re-emitting without re-escaping
    // would turn inert text into a live reference on the clone.
    const out = rewriteRefs("\\${{db.NOT_A_REF}}", rename);
    expect(out.value).toBe("\\${{db.NOT_A_REF}}");
    expect(out.external).toEqual([]);
  });

  test("copies an unparseable value verbatim", () => {
    // A clone is not the place to start rejecting values the source is
    // already running with.
    const broken = "${{unclosed";
    expect(rewriteRefs(broken, rename).value).toBe(broken);
  });

  test("leaves a plain value untouched", () => {
    expect(rewriteRefs("hello", rename).value).toBe("hello");
  });

  test("never renames a stack ref's compose key", () => {
    // `db` here is a service key INSIDE the compose file, not a project
    // resource. Renaming it would repoint the copy at whatever resource
    // happens to carry that name — the bug this case exists to pin down.
    const out = rewriteRefs("${{autumn.db.HOST}}", rename);
    expect(out.value).toBe("${{autumn.db.HOST}}");
    expect(out.external).toEqual(["autumn"]);
  });

  test("renames the stack segment when the stack itself is being copied", () => {
    const r = new Map([["autumn", "autumn-copy"]]);
    const out = rewriteRefs("${{autumn.db.HOST}}", r);
    expect(out.value).toBe("${{autumn-copy.db.HOST}}");
    expect(out.external).toEqual([]);
  });

  test("copies the self scope verbatim and never calls it external", () => {
    // `stack.` resolves against whichever stack the copy lands in, so there is
    // nothing to rewrite and nothing pointing outside the set.
    const out = rewriteRefs("postgres://${{stack.db.HOST}}:5432/app", rename);
    expect(out.value).toBe("postgres://${{stack.db.HOST}}:5432/app");
    expect(out.external).toEqual([]);
  });
});

describe("planClone", () => {
  test("names every copy without collision", () => {
    const plan = planClone([svc("r1", "api"), svc("r2", "db")], ["api", "db"], new Map());
    expect(plan.items.map((i) => i.targetName)).toEqual(["api-copy", "db-copy"]);
  });

  test("two sources with the same base get distinct names", () => {
    const plan = planClone(
      [svc("r1", "api"), svc("r2", "api-copy")],
      ["api", "api-copy"],
      new Map(),
    );
    const names = plan.items.map((i) => i.targetName);
    expect(new Set(names).size).toBe(names.length);
  });

  test("a ref to a resource later in the list is still rewritten", () => {
    // Ordering must not decide correctness: the rename map is completed before
    // any value is inspected.
    const env = new Map([["r1", { DATABASE_URL: "${{db.URL}}" }]]);
    const plan = planClone([svc("r1", "api"), svc("r2", "db")], ["api", "db"], env);
    expect(plan.externalRefs).toEqual([]);
    expect(rewriteRefs("${{db.URL}}", plan.rename).value).toBe("${{db-copy.URL}}");
  });

  test("reports a ref that will still point at the original", () => {
    // "This copy shares your production Redis" is something to know BEFORE
    // deploying it.
    const env = new Map([["r1", { REDIS_URL: "${{redis.URL}}" }]]);
    const plan = planClone([svc("r1", "api")], ["api", "redis"], env);
    expect(plan.externalRefs).toEqual([
      { fromName: "api-copy", toName: "redis", envKey: "REDIS_URL" },
    ]);
  });

  test("attributes an external ref to the CLONE, not the source", () => {
    // The warning is about the thing being created.
    const env = new Map([["r1", { X: "${{redis.URL}}" }]]);
    expect(planClone([svc("r1", "api")], ["api"], env).externalRefs[0]?.fromName).toBe("api-copy");
  });

  test("an empty set plans nothing", () => {
    const plan = planClone([], ["api"], new Map());
    expect(plan.items).toEqual([]);
    expect(plan.externalRefs).toEqual([]);
  });
});
