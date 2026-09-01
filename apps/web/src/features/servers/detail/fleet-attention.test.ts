import { describe, expect, it } from "vite-plus/test";

import { fleetAttention, type AttentionHealth, type AttentionServer } from "./fleet-attention";

function server(id: string, overrides: Partial<AttentionServer> = {}): AttentionServer {
  return {
    id,
    name: id,
    provisionStatus: "ready",
    status: "ready",
    availability: "active",
    provisionError: null,
    ...overrides,
  };
}

type Rec = NonNullable<AttentionHealth["health"]>["recommendations"][number];

function entry(stale = false, recommendations: Rec[] = []): AttentionHealth {
  return { stale, receivedAt: new Date().toISOString(), health: { recommendations } };
}

describe("fleetAttention", () => {
  it("ranks a down box above a disk warning above a silent box", () => {
    const servers = [server("quiet"), server("full"), server("gone", { status: "down" })];
    const health = new Map<string, AttentionHealth>([
      [
        "full",
        entry(false, [
          { id: "disk", severity: "warning", title: "Disk at 91%", detail: "", action: "images" },
        ]),
      ],
      ["gone", entry()],
    ]);
    const items = fleetAttention(servers, health);
    expect(items.map((i) => i.id)).toEqual(["gone:state", "full:disk", "quiet:state"]);
    expect(items[1].tab).toBe("storage");
  });

  it("does not repeat a stale box's old recommendations", () => {
    const health = new Map<string, AttentionHealth>([
      [
        "old",
        entry(true, [{ id: "disk", severity: "critical", title: "x", detail: "", action: null }]),
      ],
    ]);
    const items = fleetAttention([server("old")], health);
    expect(items).toHaveLength(1);
    expect(items[0].severity).toBe("warn");
  });

  it("never lists a pause or drain the operator chose", () => {
    const servers = [
      server("p", { availability: "pause" }),
      server("d", { availability: "drain" }),
    ];
    const health = new Map<string, AttentionHealth>([
      ["p", entry()],
      ["d", entry()],
    ]);
    expect(fleetAttention(servers, health)).toEqual([]);
  });
});
