/**
 * The presentation rules the transports share.
 *
 * These are pure, so they are worth pinning: the dedup key in particular is a
 * defect fix rather than a cosmetic one — without it PagerDuty opened a new
 * incident per occurrence, and a flapping service produced one every two
 * minutes. The test that matters most is that a degrade and its recovery
 * derive the SAME key, because that is what lets the recovery resolve the
 * incident the degrade opened.
 */

import { describe, expect, test } from "bun:test";

import { SEVERITY, alignedTable, dedupKey, detailRows, subjectOf, titleOf } from "../message";

describe("subjectOf", () => {
  test("prefers the resource over the project", () => {
    expect(subjectOf({ project: "shared", resource: "api" })).toBe("api");
  });

  test("falls back through the key order to project", () => {
    expect(subjectOf({ project: "shared" })).toBe("shared");
  });

  test("is undefined when the emitter passed no subject key", () => {
    expect(subjectOf({ duration: "1m 12s" })).toBeUndefined();
    expect(subjectOf(undefined)).toBeUndefined();
  });

  test("ignores an empty value rather than titling with a blank", () => {
    expect(subjectOf({ resource: "", project: "shared" })).toBe("shared");
  });
});

describe("titleOf", () => {
  test("names the subject, so two failures are not identical", () => {
    expect(titleOf("Deploy failed", "authentik-server")).toBe("Deploy failed · authentik-server");
    expect(titleOf("Deploy failed", "authentik-worker")).toBe("Deploy failed · authentik-worker");
  });

  test("degrades to the bare title when there is no subject", () => {
    expect(titleOf("Audit anomaly", undefined)).toBe("Audit anomaly");
  });
});

describe("detailRows", () => {
  test("drops the value already shown in the title", () => {
    const rows = detailRows({ project: "shared", resource: "api" }, "api");
    expect(rows).toEqual([["project", "shared"]]);
  });

  test("drops empty values", () => {
    expect(detailRows({ project: "shared", step: "" }, undefined)).toEqual([["project", "shared"]]);
  });
});

describe("alignedTable", () => {
  test("pads labels so the value column lines up", () => {
    const table = alignedTable([
      ["project", "shared"],
      ["first_seen", "09:27"],
    ]);
    const lines = table?.split("\n") ?? [];
    expect(lines).toHaveLength(2);
    // Every value starts at the same column, which is the whole point.
    expect(lines[0]?.indexOf("shared")).toBe(lines[1]?.indexOf("09:27"));
  });

  test("titlecases and de-snakes the label", () => {
    expect(alignedTable([["first_seen", "09:27"]])).toBe("First seen  09:27");
  });

  test("stays inside a phone's code-block width", () => {
    const table = alignedTable([
      ["resource", "authentik-server"],
      ["step", "manifest resolve"],
      ["first_seen", "09:27"],
    ]);
    for (const line of table?.split("\n") ?? []) expect(line.length).toBeLessThanOrEqual(44);
  });

  test("clips a value that would scroll the block sideways", () => {
    const long = "a".repeat(80);
    const table = alignedTable([["step", long]]);
    expect(table?.length).toBeLessThan(long.length);
    expect(table).toContain("…");
  });

  test("is undefined with no rows, so callers omit the block entirely", () => {
    expect(alignedTable([])).toBeUndefined();
  });
});

describe("dedupKey", () => {
  test("a degrade and its recovery share one incident", () => {
    expect(dedupKey("health.degraded", "api")).toBe(dedupKey("health.recovered", "api"));
  });

  test("deploy failure and success share one incident", () => {
    expect(dedupKey("deploy.failed", "api")).toBe(dedupKey("deploy.succeeded", "api"));
  });

  test("different subjects are different incidents", () => {
    expect(dedupKey("deploy.failed", "api")).not.toBe(dedupKey("deploy.failed", "worker"));
  });

  test("different families are different incidents", () => {
    expect(dedupKey("backup.failed", "db")).not.toBe(dedupKey("deploy.failed", "db"));
  });

  test("a subjectless event still gets a stable key", () => {
    expect(dedupKey("audit.anomaly", undefined)).toBe("otterdeploy/audit/instance");
  });
});

describe("SEVERITY", () => {
  test("every severity has a badge, so none can render colourless", () => {
    for (const style of Object.values(SEVERITY)) {
      expect(style.emoji).not.toBe("");
      expect(style.word).not.toBe("");
    }
  });

  test("maps onto the four levels PagerDuty accepts", () => {
    const allowed = ["critical", "warning", "error", "info"];
    for (const style of Object.values(SEVERITY)) expect(allowed).toContain(style.pd);
  });

  test("ok resolves rather than paging", () => {
    expect(SEVERITY.ok.pd).toBe("info");
  });
});
