/**
 * The rules that decide whether an absence is worth waking someone for.
 *
 * The incident these encode: a compose-member Postgres died and stayed dead
 * for two days while its deployment row still read `running`. So the cases
 * that matter most are the two ends — a redeploy blip must stay silent, and a
 * genuine outage must be announced exactly once and then closed when it comes
 * back — plus the restart case, because the watch loses its process memory far
 * more often than a real outage ends.
 */
import { ID_PREFIX, zId } from "@otterdeploy/shared/id";
import { describe, expect, it } from "vite-plus/test";

import { type MissingResource, planDownTransitions } from "../down-transitions";

const ORG = zId(ID_PREFIX.organization).parse("org_test");

const MINUTE = 60_000;
const GRACE = 5 * MINUTE;
const REMIND = 6 * 60 * MINUTE;

const missing = (resourceId: string, label = resourceId): MissingResource => ({
  resourceId,
  label,
  projectSlug: "shared",
  projectName: "shared",
  organizationId: ORG,
  kind: "service",
});

const plan = (input: {
  active: Parameters<typeof planDownTransitions>[0]["active"];
  missing: MissingResource[];
  now: number;
}) => planDownTransitions({ ...input, graceMs: GRACE, remindAfterMs: REMIND });

describe("planDownTransitions", () => {
  it("says nothing the first time a resource is missing: that is a redeploy", () => {
    const result = plan({ active: {}, missing: [missing("res_db")], now: 1_000 });
    expect(result.notify).toEqual([]);
    expect(result.recovered).toEqual([]);
    // Remembered as missing-since-now, so the clock starts here rather than
    // restarting on the next tick.
    expect(result.next.res_db).toEqual({
      missingSince: 1_000,
      notifiedAt: null,
      label: "res_db",
    });
  });

  it("announces once the grace window is past", () => {
    const active = { res_db: { missingSince: 1_000, notifiedAt: null, label: "res_db" } };
    const result = plan({ active, missing: [missing("res_db")], now: 1_000 + GRACE });
    expect(result.notify).toHaveLength(1);
    expect(result.notify[0]?.reminder).toBe(false);
    expect(result.notify[0]?.downForMs).toBe(GRACE);
    expect(result.next.res_db?.notifiedAt).toBe(1_000 + GRACE);
  });

  it("does not repeat itself on every tick", () => {
    const active = { res_db: { missingSince: 1_000, notifiedAt: 1_000, label: "res_db" } };
    const result = plan({ active, missing: [missing("res_db")], now: 1_000 + 30 * MINUTE });
    expect(result.notify).toEqual([]);
    expect(result.next.res_db?.notifiedAt).toBe(1_000);
  });

  it("reminds once the reminder window is past, and says it is a reminder", () => {
    const active = { res_db: { missingSince: 0, notifiedAt: 1_000, label: "res_db" } };
    const result = plan({ active, missing: [missing("res_db")], now: 1_000 + REMIND });
    expect(result.notify).toHaveLength(1);
    expect(result.notify[0]?.reminder).toBe(true);
    // Down-for is measured from when it went missing, not from the last
    // reminder: "still down, 2d" is the sentence that gets someone moving.
    expect(result.notify[0]?.downForMs).toBe(1_000 + REMIND);
  });

  it("keeps counting from the original absence across a control-plane restart", () => {
    // Reloaded from Redis after a restart: the window must not start over, or
    // a watch that restarts inside every grace window never announces at all.
    const active = { res_db: { missingSince: 0, notifiedAt: null, label: "res_db" } };
    const result = plan({ active, missing: [missing("res_db")], now: GRACE });
    expect(result.notify).toHaveLength(1);
  });

  it("closes an announced outage when the container comes back", () => {
    const active = { res_db: { missingSince: 0, notifiedAt: 1_000, label: "postiz / db" } };
    const result = plan({ active, missing: [], now: 10 * MINUTE });
    expect(result.recovered).toEqual([
      { resourceId: "res_db", label: "postiz / db", downForMs: 10 * MINUTE },
    ]);
    expect(result.next).toEqual({});
  });

  it("stays silent about a blip it never announced", () => {
    // Missing for one tick during a redeploy, back on the next: nobody was
    // told it was down, so nobody is told it recovered.
    const active = { res_db: { missingSince: 1_000, notifiedAt: null, label: "res_db" } };
    const result = plan({ active, missing: [], now: 2 * MINUTE });
    expect(result.notify).toEqual([]);
    expect(result.recovered).toEqual([]);
    expect(result.next).toEqual({});
  });

  it("tracks each resource on its own clock", () => {
    const active = {
      res_a: { missingSince: 0, notifiedAt: 0, label: "a" },
      res_b: { missingSince: 9 * MINUTE, notifiedAt: null, label: "b" },
    };
    const result = plan({
      active,
      missing: [missing("res_a", "a"), missing("res_b", "b")],
      now: 10 * MINUTE,
    });
    // a was announced long ago and is not due a reminder; b is one minute into
    // its own grace window.
    expect(result.notify).toEqual([]);
    expect(result.next.res_b?.missingSince).toBe(9 * MINUTE);
  });
});
