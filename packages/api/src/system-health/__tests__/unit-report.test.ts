/**
 * The ingest boundary for the `units` section. The point of these is that a
 * report from a NEWER agent (one that knows a sub-state this control plane has
 * never heard of) still lands, degraded, instead of taking the whole health
 * report down with it during a rolling upgrade.
 */
import { describe, expect, it } from "vite-plus/test";

import { systemdReportField, systemdUnitSchema } from "../unit-report";

const UNIT = {
  name: "docker.service",
  activeState: "active",
  subState: "running",
  cpuPct: 3.5,
  memBytes: 104857600,
  memPeakBytes: 209715200,
  restartCount: 2,
  activeEnterTimestamp: "2026-08-18T09:12:31.000Z",
};

describe("systemdUnitSchema", () => {
  it("round-trips a well-formed unit", () => {
    expect(systemdUnitSchema.parse(UNIT)).toEqual(UNIT);
  });

  it("a state this version has never heard of degrades to 'unknown'", () => {
    const parsed = systemdUnitSchema.parse({
      ...UNIT,
      activeState: "refreshing",
      subState: "dead-resources-pinned-v9",
    });
    expect(parsed.activeState).toBe("unknown");
    expect(parsed.subState).toBe("unknown");
  });

  it("keeps null memory as null rather than coercing it to zero", () => {
    const parsed = systemdUnitSchema.parse({ ...UNIT, memBytes: null, memPeakBytes: null });
    expect(parsed.memBytes).toBeNull();
    expect(parsed.memPeakBytes).toBeNull();
  });

  it("a nonsense cpuPct falls back to 0", () => {
    expect(systemdUnitSchema.parse({ ...UNIT, cpuPct: -4 }).cpuPct).toBe(0);
    expect(systemdUnitSchema.parse({ ...UNIT, cpuPct: 4000 }).cpuPct).toBe(0);
  });

  it("rejects a unit with no name: there is nothing to key a row on", () => {
    expect(systemdUnitSchema.safeParse({ ...UNIT, name: "" }).success).toBe(false);
    expect(systemdUnitSchema.safeParse({ ...UNIT, name: undefined }).success).toBe(false);
  });
});

describe("systemdReportField", () => {
  it("accepts a section", () => {
    const parsed = systemdReportField.parse({ units: [UNIT], sampledAt: "2026-08-21T00:00:00Z" });
    expect(parsed?.units).toHaveLength(1);
  });

  it("accepts null: a host without systemd has no units, and says so", () => {
    expect(systemdReportField.parse(null)).toBeNull();
  });

  it("accepts an omitted section: an older agent does not send one", () => {
    expect(systemdReportField.parse(undefined)).toBeUndefined();
  });

  it("rejects an absurd unit count", () => {
    const units = Array.from({ length: 401 }, (_, i) => ({ ...UNIT, name: `u${i}.service` }));
    expect(systemdReportField.safeParse({ units, sampledAt: "2026-08-21T00:00:00Z" }).success).toBe(
      false,
    );
  });
});
