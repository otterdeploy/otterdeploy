import { describe, expect, it } from "vite-plus/test";

import { classifyCliCompat, MIN_CLI_VERSION } from "./compat";

const ok = { kind: "ok" } as const;

describe("classifyCliCompat", () => {
  it("stays silent when both halves are on the same release", () => {
    expect(
      classifyCliCompat({ cliVersion: "0.7.0", serverVersion: "0.7.0", minCliVersion: "0.1.0" }),
    ).toEqual(ok);
  });

  it("accepts the v prefix on either side", () => {
    expect(
      classifyCliCompat({ cliVersion: "v0.7.0", serverVersion: "v0.7.0", minCliVersion: "v0.1.0" }),
    ).toEqual(ok);
  });

  it("flags a CLI below the server's floor", () => {
    expect(
      classifyCliCompat({ cliVersion: "0.6.9", serverVersion: "0.9.0", minCliVersion: "0.7.0" }),
    ).toEqual({
      kind: "cli-too-old",
      cliVersion: "0.6.9",
      serverVersion: "0.9.0",
      minCliVersion: "0.7.0",
    });
  });

  it("treats the floor as exact, not minor-rounded", () => {
    expect(
      classifyCliCompat({ cliVersion: "0.7.0", serverVersion: "0.9.0", minCliVersion: "0.7.1" }),
    ).toMatchObject({ kind: "cli-too-old" });
    expect(
      classifyCliCompat({ cliVersion: "0.7.1", serverVersion: "0.9.0", minCliVersion: "0.7.1" }),
    ).toEqual(ok);
  });

  // The floor alone decides this case, so a dev server still reports it.
  it("reports a too-old CLI even when the server version is a sentinel", () => {
    expect(
      classifyCliCompat({ cliVersion: "0.6.0", serverVersion: "dev", minCliVersion: "0.7.0" }),
    ).toEqual({
      kind: "cli-too-old",
      cliVersion: "0.6.0",
      serverVersion: null,
      minCliVersion: "0.7.0",
    });
  });

  it("flags a control plane a minor behind the CLI", () => {
    expect(
      classifyCliCompat({ cliVersion: "0.9.0", serverVersion: "0.7.3", minCliVersion: "0.1.0" }),
    ).toEqual({ kind: "server-behind", cliVersion: "0.9.0", serverVersion: "0.7.3" });
  });

  it("ignores a patch-only gap in either direction", () => {
    expect(
      classifyCliCompat({ cliVersion: "0.7.4", serverVersion: "0.7.0", minCliVersion: "0.1.0" }),
    ).toEqual(ok);
    expect(
      classifyCliCompat({ cliVersion: "0.7.0", serverVersion: "0.7.4", minCliVersion: "0.1.0" }),
    ).toEqual(ok);
  });

  it("never complains that the server is AHEAD. That is the normal case", () => {
    expect(
      classifyCliCompat({ cliVersion: "0.7.0", serverVersion: "1.4.0", minCliVersion: "0.1.0" }),
    ).toEqual(ok);
  });

  // A dev control plane reports OTTERDEPLOY_VERSION="dev"; nagging on every
  // command in local development would train everyone to ignore the warning.
  it("stays silent when either side is not a real release", () => {
    for (const sentinel of ["dev", "latest", "", null, undefined]) {
      expect(
        classifyCliCompat({
          cliVersion: "0.9.0",
          serverVersion: sentinel,
          minCliVersion: "0.1.0",
        }),
      ).toEqual(ok);
      expect(
        classifyCliCompat({
          cliVersion: sentinel,
          serverVersion: "0.1.0",
          minCliVersion: "0.9.0",
        }),
      ).toEqual(ok);
    }
  });

  // An older control plane sends no headers at all. Absent must mean "no
  // opinion", never "floor of zero" or a spurious verdict.
  it("stays silent when the server sent no compat headers", () => {
    expect(
      classifyCliCompat({ cliVersion: "0.7.0", serverVersion: null, minCliVersion: null }),
    ).toEqual(ok);
  });

  // Guards the documented invariant in compat.ts: the floor tracks known
  // breakage, not the current release. If someone bumps it to "whatever we just
  // shipped", every CLI in the wild starts warning on every command.
  it("ships a floor no newer than the oldest CLI ever published", () => {
    expect(MIN_CLI_VERSION).toBe("0.1.0");
  });
});
