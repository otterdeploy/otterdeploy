import { describe, expect, test } from "vite-plus/test";

import { buildNodeEnrollmentScript } from "../enrollment-script";

describe("buildNodeEnrollmentScript", () => {
  test("joins once and reports completion with bounded retries", () => {
    const script = buildNodeEnrollmentScript({
      joinToken: "SWMTKN-worker-secret",
      managerAddr: "10.0.0.4:2377",
      completeUrl: "https://deploy.example/api/node-enrollments/enroll_1/complete",
      credential: `enroll_1.${"x".repeat(43)}`,
    });

    expect(script.startsWith("#!/bin/sh\nset -eu\n")).toBe(true);
    expect(script).toContain("docker swarm join --token 'SWMTKN-worker-secret' '10.0.0.4:2377'");
    expect(script).toContain("curl -fsS --retry 5 --retry-all-errors -X POST");
    expect(script).toContain("'Authorization: Bearer enroll_1.");
    expect(script).not.toContain("set -x");
  });

  test("quotes every control-plane value as inert POSIX shell data", () => {
    const injection = "'; touch /tmp/otterdeploy-pwned; #";
    const script = buildNodeEnrollmentScript({
      joinToken: injection,
      managerAddr: injection,
      completeUrl: injection,
      credential: injection,
    });

    expect(script).toContain(`'${injection.replaceAll("'", "'\"'\"'")}'`);
    expect(script).not.toContain(`--token ${injection}`);
    expect(script).not.toContain(`-X POST ${injection}`);
  });
});
