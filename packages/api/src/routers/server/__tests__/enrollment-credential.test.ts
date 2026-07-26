import { describe, expect, test } from "vite-plus/test";

import {
  buildSwarmRotationOptions,
  hashEnrollmentCredential,
  parseEnrollmentCredential,
} from "../enrollment-credential";

describe("node enrollment credentials", () => {
  test("accepts only an enrollment id followed by a high-entropy base64url secret", () => {
    const id = "enroll_abcdefghijkmnpqrstuvwxyz";
    const credential = `${id}.${"a".repeat(43)}`;
    expect(parseEnrollmentCredential(credential)).toEqual({ id });

    expect(
      parseEnrollmentCredential("server_abcdefghijkmnpqrstuvwxyz." + "a".repeat(43)),
    ).toBeNull();
    expect(parseEnrollmentCredential(`${id}.short`)).toBeNull();
    expect(parseEnrollmentCredential(`${id}.${"a".repeat(42)}!`)).toBeNull();
    expect(parseEnrollmentCredential(`${id}.${"a".repeat(44)}`)).toBeNull();
    expect(parseEnrollmentCredential(id)).toBeNull();
  });

  test("stores a stable one-way digest rather than the bearer", () => {
    const first = "enroll_01JTESTVALUE." + "a".repeat(43);
    const second = "enroll_01JTESTVALUE." + "b".repeat(43);
    const digest = hashEnrollmentCredential(first);

    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain(first);
    expect(digest).toBe(hashEnrollmentCredential(first));
    expect(digest).not.toBe(hashEnrollmentCredential(second));
  });
});

describe("Swarm join-token rotation options", () => {
  const swarm = {
    Version: { Index: 42 },
    Spec: {
      Name: "prod",
      Labels: { region: "eu" },
      Orchestration: { TaskHistoryRetentionLimit: 5 },
    },
  };

  test("preserves the current Swarm spec and rotates only the worker token", () => {
    expect(buildSwarmRotationOptions(swarm, "worker")).toEqual({
      version: 42,
      ...swarm.Spec,
      rotateWorkerToken: true,
      rotateManagerToken: false,
    });
  });

  test("rotates only the separately protected manager token", () => {
    expect(buildSwarmRotationOptions(swarm, "manager")).toEqual({
      version: 42,
      ...swarm.Spec,
      rotateWorkerToken: false,
      rotateManagerToken: true,
    });
  });

  test("refuses a blind update without Docker's optimistic-lock version", () => {
    expect(() => buildSwarmRotationOptions({ Spec: swarm.Spec }, "worker")).toThrow(
      "Swarm version is unavailable.",
    );
  });
});
