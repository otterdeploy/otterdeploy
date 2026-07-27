import { describe, expect, test } from "vite-plus/test";

import { computeEnrollmentStages, type EnrollmentProgressRow } from "./enrollment-progress";
import { MANAGER_CONFIRMATION, submitBlocker } from "./join-token-step-up";

const NOW = Date.parse("2026-07-27T12:00:00.000Z");

const row = (overrides: Partial<EnrollmentProgressRow> = {}): EnrollmentProgressRow => ({
  id: "enr_1",
  role: "worker",
  status: "active",
  createdAt: "2026-07-27T11:59:00.000Z",
  expiresAt: "2026-07-27T12:09:00.000Z",
  redeemedAt: null,
  completedAt: null,
  ...overrides,
});

const stateOf = (stages: ReturnType<typeof computeEnrollmentStages>, key: string) =>
  stages.find((s) => s.key === key)?.state;

const detailOf = (stages: ReturnType<typeof computeEnrollmentStages>, key: string) =>
  stages.find((s) => s.key === key)?.detail;

describe("submitBlocker", () => {
  const base = {
    sessionPending: false,
    twoFactorEnabled: false,
    credentialReady: true,
    role: "worker" as const,
    managerConfirmation: "",
  };

  test("holds submission while the session is still loading", () => {
    // Guessing twoFactorEnabled here would render the wrong credential field.
    expect(submitBlocker({ ...base, sessionPending: true })).toMatch(/Checking which credential/);
  });

  test("names the authenticator when 2FA is enrolled", () => {
    expect(submitBlocker({ ...base, twoFactorEnabled: true, credentialReady: false })).toMatch(
      /authenticator app/,
    );
  });

  test("names the password when 2FA is not enrolled", () => {
    expect(submitBlocker({ ...base, credentialReady: false })).toMatch(/account password/);
  });

  test("a ready worker is unblocked", () => {
    expect(submitBlocker(base)).toBeNull();
  });

  test("manager role is blocked until the confirmation matches exactly", () => {
    expect(submitBlocker({ ...base, role: "manager" })).toContain(MANAGER_CONFIRMATION);
    // Near-misses must stay blocked — this is the case that read as a hung button.
    expect(
      submitBlocker({ ...base, role: "manager", managerConfirmation: "enroll manager" }),
    ).toContain(MANAGER_CONFIRMATION);
    expect(
      submitBlocker({ ...base, role: "manager", managerConfirmation: `${MANAGER_CONFIRMATION} ` }),
    ).toContain(MANAGER_CONFIRMATION);
  });

  test("manager role is unblocked by the exact confirmation", () => {
    expect(
      submitBlocker({ ...base, role: "manager", managerConfirmation: MANAGER_CONFIRMATION }),
    ).toBeNull();
  });

  test("credential is checked before the manager confirmation", () => {
    const reason = submitBlocker({
      ...base,
      role: "manager",
      credentialReady: false,
      managerConfirmation: MANAGER_CONFIRMATION,
    });
    expect(reason).toMatch(/account password/);
  });
});

describe("computeEnrollmentStages", () => {
  test("waiting on the host: redeem active, install and join not started", () => {
    const stages = computeEnrollmentStages(row(), NOW);
    expect(stateOf(stages, "created")).toBe("done");
    expect(stateOf(stages, "redeem")).toBe("active");
    expect(stateOf(stages, "install")).toBe("pending");
    expect(stateOf(stages, "joined")).toBe("pending");
    expect(detailOf(stages, "redeem")).toContain("expires in 9m");
  });

  test("redeemed: install is active and admits we cannot see inside the host", () => {
    const stages = computeEnrollmentStages(
      row({ status: "redeemed", redeemedAt: "2026-07-27T11:59:30.000Z" }),
      NOW,
    );
    expect(stateOf(stages, "redeem")).toBe("done");
    expect(stateOf(stages, "install")).toBe("active");
    expect(stateOf(stages, "joined")).toBe("pending");
    expect(detailOf(stages, "install")).toContain("cannot see inside the host");
    expect(detailOf(stages, "install")).toContain("30s");
  });

  test("completed: every stage done, with the total elapsed", () => {
    const stages = computeEnrollmentStages(
      row({
        status: "completed",
        redeemedAt: "2026-07-27T11:59:30.000Z",
        completedAt: "2026-07-27T12:00:00.000Z",
      }),
      NOW,
    );
    expect(stages.every((s) => s.state === "done")).toBe(true);
    expect(detailOf(stages, "joined")).toContain("Completed in 1m");
  });

  test("expired before redeem fails the redeem stage and says to make a new one", () => {
    const stages = computeEnrollmentStages(row({ status: "expired" }), NOW);
    expect(stateOf(stages, "redeem")).toBe("failed");
    expect(stateOf(stages, "install")).toBe("pending");
    expect(detailOf(stages, "redeem")).toContain("Create a new one");
  });

  test("revoked mid-install fails the install stage, not the completed redeem", () => {
    const stages = computeEnrollmentStages(
      row({ status: "revoked", redeemedAt: "2026-07-27T11:59:30.000Z" }),
      NOW,
    );
    expect(stateOf(stages, "redeem")).toBe("done");
    expect(stateOf(stages, "install")).toBe("failed");
  });

  test("a past expiry never renders as negative time remaining", () => {
    const stages = computeEnrollmentStages(row({ expiresAt: "2026-07-27T11:50:00.000Z" }), NOW);
    expect(detailOf(stages, "redeem")).toContain("0s");
    expect(detailOf(stages, "redeem")).not.toContain("-");
  });
});
