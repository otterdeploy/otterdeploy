import { describe, expect, it } from "vite-plus/test";

import { encodeSubject } from "@otterdeploy/shared/inbox-subject";

import { conditionKey, deriveOpenConditions, type ConditionSourceRow } from "../conditions";

const NOW = new Date("2026-09-01T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

let seq = 0;
function row(
  eventId: string,
  data: Record<string, string>,
  at: Date,
  extra: Partial<ConditionSourceRow> = {},
): ConditionSourceRow {
  seq += 1;
  return {
    id: `ntf_${seq}`,
    title: eventId,
    message: "",
    data: { eventId, occurrence: `job:${seq}`, ...data },
    readAt: null,
    createdAt: at,
    ...extra,
  };
}

const host = encodeSubject({ kind: "server", id: "hetzner-1", label: "hetzner-1" });
const api = encodeSubject({ kind: "service", id: "res_api", label: "api", project: "acme-shop" });

describe("conditionKey", () => {
  it("keys pressure by server and recommendation, deploy/health by subject", () => {
    // Pressure is keyed on the recommendation alone: instance-wide, and rows
    // written before subjects existed must fold with rows written after.
    expect(conditionKey("host.pressure", { ...host, recommendation: "memory-critical" })).toBe(
      "pressure:memory-critical",
    );
    expect(conditionKey("host.pressure", { recommendation: "memory-critical" })).toBe(
      "pressure:memory-critical",
    );
    expect(conditionKey("deploy.failed", api)).toBe("deploy:res_api");
    expect(conditionKey("build.failed", api)).toBe("deploy:res_api");
    expect(conditionKey("health.degraded", api)).toBe("health:res_api");
  });

  it("falls back to legacy display strings for rows written before subjects", () => {
    expect(conditionKey("deploy.failed", { resource: "api", project: "Acme" })).toBe("deploy:api");
    expect(conditionKey("backup.failed", { resourceId: "res_pg", resource: "postgres" })).toBe(
      "backup:res_pg",
    );
  });

  it("returns null for records that are not states", () => {
    expect(conditionKey("ssh.rotated", { server: "x" })).toBeNull();
    expect(conditionKey("edge.probe", { ip: "1.2.3.4" })).toBeNull();
    expect(conditionKey("backup.overdue", { resourceId: "res_pg" })).toBeNull();
    expect(conditionKey("host.pressure", host)).toBeNull(); // no recommendation
  });
});

describe("deriveOpenConditions", () => {
  it("folds a re-notified pressure warning into one condition with a count", () => {
    const rows = [3, 9, 15, 26].map((m) =>
      row("host.pressure", { ...host, recommendation: "disk-pressure", severity: "warning", action: "images" }, minutesAgo(m)),
    );
    const { open, consumed } = deriveOpenConditions(rows, NOW);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      key: "pressure:disk-pressure",
      severity: "warn",
      count: 4,
      action: { kind: "reclaim", target: "images" },
      subject: { kind: "server", id: "hetzner-1" },
    });
    expect(open[0]?.firstAt).toEqual(minutesAgo(26));
    expect(open[0]?.lastAt).toEqual(minutesAgo(3));
    expect(consumed.size).toBe(4);
  });

  it("takes the subject from the newest occurrence that has one", () => {
    const rows = [
      row("host.pressure", { recommendation: "disk-pressure", severity: "warning" }, minutesAgo(1)),
      row("host.pressure", { ...host, recommendation: "disk-pressure", severity: "warning" }, minutesAgo(8)),
    ];
    expect(deriveOpenConditions(rows, NOW).open[0]?.subject).toEqual({ kind: "server", id: "hetzner-1", label: "hetzner-1" });
  });

  it("grades pressure from the payload: critical memory is err, not the catalog's warn", () => {
    const rows = [row("host.pressure", { ...host, recommendation: "memory-critical", severity: "critical" }, minutesAgo(1))];
    expect(deriveOpenConditions(rows, NOW).open[0]?.severity).toBe("err");
  });

  it("closes a pressure condition on its clear event and consumes nothing", () => {
    const rows = [
      row("host.pressure.cleared", { ...host, recommendation: "disk-pressure" }, minutesAgo(1)),
      row("host.pressure", { ...host, recommendation: "disk-pressure", severity: "warning" }, minutesAgo(30)),
    ];
    const { open, consumed } = deriveOpenConditions(rows, NOW);
    expect(open).toHaveLength(0);
    expect(consumed.size).toBe(0);
  });

  it("treats a pressure warning with no clear for a day as stale, not open", () => {
    const rows = [row("host.pressure", { ...host, recommendation: "disk-pressure", severity: "warning" }, minutesAgo(25 * 60))];
    expect(deriveOpenConditions(rows, NOW).open).toHaveLength(0);
  });

  it("a failed deploy is open until a later success on the same resource", () => {
    const failed = [row("deploy.failed", { ...api, deploymentId: "dep_1" }, minutesAgo(10))];
    expect(deriveOpenConditions(failed, NOW).open[0]).toMatchObject({ key: "deploy:res_api", severity: "err" });

    const fixed = [
      row("deploy.succeeded", { ...api, deploymentId: "dep_2" }, minutesAgo(2)),
      ...failed,
    ];
    expect(deriveOpenConditions(fixed, NOW).open).toHaveLength(0);
  });

  it("a new deploy starting does not resolve the failure, only succeeding does", () => {
    const rows = [
      row("deploy.started", { ...api, deploymentId: "dep_2" }, minutesAgo(1)),
      row("deploy.failed", { ...api, deploymentId: "dep_1" }, minutesAgo(10)),
    ];
    // Newest row is `started`, which neither opens nor resolves: the newest
    // row decides, and it says "nothing to report" — the failure is history
    // that a deploy is already addressing.
    expect(deriveOpenConditions(rows, NOW).open).toHaveLength(0);
  });

  it("degraded then recovered is settled; recovered then degraded is open", () => {
    const settled = [
      row("health.recovered", api, minutesAgo(5)),
      row("health.degraded", api, minutesAgo(12)),
    ];
    expect(deriveOpenConditions(settled, NOW).open).toHaveLength(0);
    const open = [
      row("health.degraded", api, minutesAgo(5)),
      row("health.recovered", api, minutesAgo(12)),
    ];
    expect(deriveOpenConditions(open, NOW).open[0]).toMatchObject({ key: "health:res_api", severity: "warn", count: 1 });
  });

  it("reports the worst grade across the run and unread when any occurrence is unread", () => {
    const rows = [
      row("host.pressure", { ...host, recommendation: "memory-critical", severity: "warning" }, minutesAgo(1), { readAt: NOW }),
      row("host.pressure", { ...host, recommendation: "memory-critical", severity: "critical" }, minutesAgo(7)),
    ];
    const [c] = deriveOpenConditions(rows, NOW).open;
    expect(c?.severity).toBe("err");
    expect(c?.unread).toBe(true);
  });

  it("orders worst first, then most recent", () => {
    const rows = [
      row("host.pressure", { ...host, recommendation: "disk-pressure", severity: "warning" }, minutesAgo(1)),
      row("deploy.failed", { ...api, deploymentId: "dep_1" }, minutesAgo(40)),
      row("backup.failed", { resourceId: "res_pg", resource: "postgres" }, minutesAgo(20)),
    ];
    expect(deriveOpenConditions(rows, NOW).open.map((c) => c.key)).toEqual([
      "backup:res_pg",
      "deploy:res_api",
      "pressure:disk-pressure",
    ]);
  });
});
