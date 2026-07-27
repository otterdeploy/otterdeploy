/**
 * Unit tests for the per-build helper's `docker run` argv composition
 * (od-5j8.15 — container hardening + trimmed secret forwarding). These are
 * pure-function tests: they assert on the constructed argv, not on a real
 * `docker run` invocation, so they run hermetically (no docker daemon, no
 * real secrets) and still catch a flag being dropped by a future edit.
 */
import { describe, expect, test } from "bun:test";

import {
  buildHelperEnvFlags,
  buildHelperRunArgs,
  FORWARDED_ENV,
  clampCpus,
  helperHardeningFlags,
  helperHardeningFromEnv,
} from "../helper-args";

describe("buildHelperEnvFlags", () => {
  test("forwards only the keys present in the source env", () => {
    const flags = buildHelperEnvFlags({
      DATABASE_URL: "postgres://x",
      REDIS_URL: "redis://y",
      // BETTER_AUTH_URL/BETTER_AUTH_SECRET/CORS_ORIGIN/NODE_ENV/OTTERDEPLOY_DATA_DIR unset
    });
    expect(flags).toEqual(["-e", "DATABASE_URL", "-e", "REDIS_URL"]);
  });

  test("never forwards RESEND_API_KEY, RESEND_FROM_EMAIL, or PUBLIC_WEB_URL even when set", () => {
    // Regression guard for the od-5j8.15 trim: these are present in a real
    // worker's env (the worker itself needs them) but must never reach the
    // helper — it doesn't use them, so a compromised helper shouldn't be
    // able to read them either.
    const flags = buildHelperEnvFlags({
      DATABASE_URL: "postgres://x",
      RESEND_API_KEY: "re_secret_key",
      RESEND_FROM_EMAIL: "noreply@example.com",
      PUBLIC_WEB_URL: "https://example.com",
    });
    expect(flags).not.toContain("RESEND_API_KEY");
    expect(flags).not.toContain("RESEND_FROM_EMAIL");
    expect(flags).not.toContain("PUBLIC_WEB_URL");
    expect(flags.join(" ")).not.toMatch(/re_secret_key/);
    expect(FORWARDED_ENV).not.toContain("RESEND_API_KEY");
    expect(FORWARDED_ENV).not.toContain("RESEND_FROM_EMAIL");
    expect(FORWARDED_ENV).not.toContain("PUBLIC_WEB_URL");
  });

  test("rewrites a localhost DATABASE_URL/REDIS_URL to host.docker.internal", () => {
    const flags = buildHelperEnvFlags({
      DATABASE_URL: "postgres://user:pass@localhost:5432/db",
      REDIS_URL: "redis://127.0.0.1:6379",
    });
    expect(flags).toEqual([
      "-e",
      "DATABASE_URL=postgres://user:pass@host.docker.internal:5432/db",
      "-e",
      "REDIS_URL=redis://host.docker.internal:6379",
    ]);
  });

  test("leaves a non-loopback DATABASE_URL/REDIS_URL untouched (passed by name only)", () => {
    const flags = buildHelperEnvFlags({
      DATABASE_URL: "postgres://user:pass@postgres:5432/db",
      REDIS_URL: "redis://redis:6379",
    });
    // Forwarded by name (`-e KEY`), not by value — `docker run -e KEY` (no
    // `=value`) passes the CURRENT process value through unmodified. Only
    // the rewritten localhost case above needs an explicit `=value`.
    expect(flags).toEqual(["-e", "DATABASE_URL", "-e", "REDIS_URL"]);
  });

  test("does not rewrite non-connection keys even if they contain 'localhost'", () => {
    const flags = buildHelperEnvFlags({ CORS_ORIGIN: "http://localhost:3000" });
    expect(flags).toEqual(["-e", "CORS_ORIGIN"]);
  });
});

describe("helperHardeningFlags", () => {
  test("drops all capabilities and blocks privilege escalation by default", () => {
    const flags = helperHardeningFlags();
    expect(flags).toEqual([
      "--security-opt",
      "no-new-privileges",
      "--cap-drop",
      "ALL",
      "--pids-limit",
      "512",
      "--memory",
      "4g",
      "--memory-swap",
      "4g",
      "--cpus",
      "2",
    ]);
  });

  test("never adds capabilities back (no --cap-add anywhere in the defaults)", () => {
    const flags = helperHardeningFlags();
    expect(flags).not.toContain("--cap-add");
  });

  test("caps memory-swap at the same value as memory (no swap headroom)", () => {
    const flags = helperHardeningFlags({ memory: "8g" });
    const memIdx = flags.indexOf("--memory");
    const swapIdx = flags.indexOf("--memory-swap");
    expect(flags[memIdx + 1]).toBe("8g");
    expect(flags[swapIdx + 1]).toBe("8g");
  });

  test("accepts overrides for pids/memory/cpus", () => {
    const flags = helperHardeningFlags({ pidsLimit: "128", memory: "1g", cpus: "0.5" });
    expect(flags).toContain("128");
    expect(flags).toContain("1g");
    expect(flags).toContain("0.5");
  });

  test("clamps --cpus to the host's CPU count", () => {
    // The single-vCPU box. Docker REJECTS a request above the host count —
    // "range of CPUs is from 0.01 to 1.00, as there are only 1 CPUs available"
    // — and the helper exits 125 before the build starts, so the default of 2
    // failed every build on the cheapest VPS tier.
    const flags = helperHardeningFlags({}, 1);
    expect(flags[flags.indexOf("--cpus") + 1]).toBe("1");
  });

  test("leaves --cpus alone when the host has the cores", () => {
    const flags = helperHardeningFlags({}, 8);
    expect(flags[flags.indexOf("--cpus") + 1]).toBe("2");
  });

  test("clamps an explicit override too", () => {
    // A tuning knob the host can't satisfy is still an unstartable build.
    const flags = helperHardeningFlags({ cpus: "4" }, 2);
    expect(flags[flags.indexOf("--cpus") + 1]).toBe("2");
  });

  test("skips clamping when the host count is unknown", () => {
    // Preserves the previous behaviour rather than guessing a limit.
    const flags = helperHardeningFlags({ cpus: "2" }, null);
    expect(flags[flags.indexOf("--cpus") + 1]).toBe("2");
  });
});

describe("clampCpus", () => {
  test("returns the request untouched when it fits", () => {
    expect(clampCpus("2", 4)).toBe("2");
    expect(clampCpus("0.5", 1)).toBe("0.5");
    expect(clampCpus("1", 1)).toBe("1");
  });

  test("reduces to the host count when it doesn't", () => {
    expect(clampCpus("2", 1)).toBe("1");
    expect(clampCpus("16", 2)).toBe("2");
  });

  test("respects docker's 0.01 floor on fractional hosts", () => {
    expect(clampCpus("2", 0.005)).toBe("0.01");
  });

  test("hands unparseable values to docker unchanged", () => {
    // Docker's own error names the problem better than a silent substitution.
    expect(clampCpus("abc", 1)).toBe("abc");
    expect(clampCpus("0", 1)).toBe("0");
    expect(clampCpus("-1", 1)).toBe("-1");
  });
});

describe("helperHardeningFromEnv", () => {
  test("returns no overrides when the tuning env vars are unset", () => {
    expect(helperHardeningFromEnv({})).toEqual({});
  });

  test("reads BUILDER_HELPER_* overrides from the given env", () => {
    expect(
      helperHardeningFromEnv({
        BUILDER_HELPER_PIDS_LIMIT: "256",
        BUILDER_HELPER_MEMORY: "2g",
        BUILDER_HELPER_CPUS: "1",
      }),
    ).toEqual({ pidsLimit: "256", memory: "2g", cpus: "1" });
  });
});

describe("buildHelperRunArgs", () => {
  const baseArgs = {
    deploymentId: "dep_123" as never,
    network: "otterdeploy_default",
    image: "otterdeploy-builder:latest",
    envFlags: ["-e", "DATABASE_URL"],
    sourceFlags: [],
    cacheFlags: [],
    hardeningFlags: helperHardeningFlags(),
  };

  test("includes the hardening flags in the composed argv", () => {
    const args = buildHelperRunArgs(baseArgs);
    expect(args).toEqual(
      expect.arrayContaining([
        "--security-opt",
        "no-new-privileges",
        "--cap-drop",
        "ALL",
        "--pids-limit",
        "512",
        "--memory",
        "4g",
        "--cpus",
        "2",
      ]),
    );
  });

  test("still mounts the raw docker.sock (documented, unclosed gap — see od-5j8.15 notes)", () => {
    const args = buildHelperRunArgs(baseArgs);
    const idx = args.indexOf("/var/run/docker.sock:/var/run/docker.sock");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx - 1]).toBe("-v");
  });

  test("names the container after the deployment id and runs build-one.ts with it", () => {
    const args = buildHelperRunArgs(baseArgs);
    expect(args).toContain("otterbuild-dep_123");
    expect(args.slice(-4)).toEqual(["bun", "run", "src/build-one.ts", "dep_123"]);
  });

  test("places hardening flags before the --add-host / socket mount / env flags", () => {
    const args = buildHelperRunArgs(baseArgs);
    const hardeningIdx = args.indexOf("--security-opt");
    const socketIdx = args.indexOf("/var/run/docker.sock:/var/run/docker.sock");
    const envIdx = args.indexOf("DATABASE_URL");
    expect(hardeningIdx).toBeGreaterThan(-1);
    expect(hardeningIdx).toBeLessThan(socketIdx);
    expect(hardeningIdx).toBeLessThan(envIdx);
  });
});
