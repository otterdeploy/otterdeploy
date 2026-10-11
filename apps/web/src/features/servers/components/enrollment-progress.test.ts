import { describe, expect, test } from "vite-plus/test";

import {
  commandPhase,
  enrollmentSteps,
  enrollmentTook,
  type EnrollmentProgressRow,
} from "./enrollment-progress";

const NOW = Date.parse("2026-07-27T12:00:00.000Z");

const row = (overrides: Partial<EnrollmentProgressRow> = {}): EnrollmentProgressRow => ({
  id: "nen_1",
  role: "worker",
  status: "active",
  createdAt: "2026-07-27T11:59:00.000Z",
  expiresAt: "2026-07-27T12:09:00.000Z",
  redeemedAt: null,
  completedAt: null,
  ...overrides,
});

const created = { expiresAt: "2026-07-27T12:09:00.000Z" };

describe("commandPhase", () => {
  test("asks to confirm until a command exists", () => {
    expect(commandPhase(null, undefined, NOW)).toBe("confirm");
  });

  test("a fresh command is ready even before the list has polled it", () => {
    expect(commandPhase(created, undefined, NOW)).toBe("ready");
    expect(commandPhase(created, row(), NOW)).toBe("ready");
  });

  test("the server running it moves the tab to installing", () => {
    const redeemed = row({ status: "redeemed", redeemedAt: "2026-07-27T11:59:06.000Z" });
    expect(commandPhase(created, redeemed, NOW)).toBe("installing");
  });

  test("completion reads as connected", () => {
    const done = row({
      status: "completed",
      redeemedAt: "2026-07-27T11:59:06.000Z",
      completedAt: "2026-07-27T12:01:14.000Z",
    });
    expect(commandPhase(created, done, NOW)).toBe("connected");
  });

  test("an unredeemed command past its expiry is expired without waiting for a poll", () => {
    expect(commandPhase(created, row(), Date.parse("2026-07-27T12:09:00.000Z"))).toBe("expired");
    expect(commandPhase(created, row({ status: "expired" }), NOW)).toBe("expired");
  });

  test("a revoked command says so, even mid-install", () => {
    const revoked = row({ status: "revoked", redeemedAt: "2026-07-27T11:59:06.000Z" });
    expect(commandPhase(created, revoked, NOW)).toBe("revoked");
  });
});

describe("enrollmentSteps", () => {
  const states = (r: EnrollmentProgressRow) => enrollmentSteps(r).map((s) => s.state);

  test("names the four steps the control plane can observe", () => {
    expect(enrollmentSteps(row()).map((s) => s.label)).toEqual([
      "Command created",
      "Server ran it",
      "Joining",
      "Connected",
    ]);
  });

  test("redeemed: joining is the step in progress, timed from creation", () => {
    const steps = enrollmentSteps(
      row({ status: "redeemed", redeemedAt: "2026-07-27T11:59:06.000Z" }),
    );
    expect(steps.map((s) => s.state)).toEqual(["done", "done", "active", "pending"]);
    expect(steps.map((s) => s.at)).toEqual(["0:00", "0:06", null, null]);
  });

  test("completed: every step done, the last two at the moment the server reported", () => {
    const steps = enrollmentSteps(
      row({
        status: "completed",
        redeemedAt: "2026-07-27T11:59:06.000Z",
        completedAt: "2026-07-27T12:01:14.000Z",
      }),
    );
    expect(steps.every((s) => s.state === "done")).toBe(true);
    expect(steps.at(-1)?.at).toBe("2:14");
  });

  test("before the server runs it, nothing after is claimed", () => {
    expect(states(row())).toEqual(["done", "active", "pending", "pending"]);
  });
});

describe("enrollmentTook", () => {
  test("is the span from creation to completion, and null before that", () => {
    expect(enrollmentTook(row())).toBeNull();
    expect(
      enrollmentTook(row({ status: "completed", completedAt: "2026-07-27T12:01:14.000Z" })),
    ).toBe(134_000);
  });
});
