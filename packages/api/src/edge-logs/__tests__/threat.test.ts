import { describe, expect, test } from "vite-plus/test";

import { classifyThreat, isSuspiciousPath, THREAT_SQL_REGEX } from "../threat";

// Real probe paths observed in the edge logs (screenshot) + classic scanners.
const PROBES = [
  "/debug/default/view?panel=config",
  "/.vscode/sftp.json",
  "/@vite/env",
  "/trace.axd",
  "/actuator/env",
  "/nodesync?cmd=hostname",
  "/exec?cmd=hostname",
  "/info.php",
  "/php-cgi/php-cgi.exe?%ADd+cgi.force_redirect%3D0",
  "/telescope/requests",
  "/config.json",
  "/s/933313e2739313e2333323e2736313/_/;/META-INF/maven/com.atlassian",
  "/.env",
  "/.git/config",
  "/.aws/credentials",
  "/wp-login.php",
  "/cgi-bin/luci",
];

// Ordinary requests a real client makes — must NOT be flagged.
const LEGIT = [
  "/",
  "/api/projects",
  "/assets/index-4af3.js",
  "/.well-known/security.txt",
  "/.well-known/acme-challenge/abc123",
  "/favicon.ico",
  "/robots.txt",
  "/manifest.json",
  "/images/logo.png",
  "/docs/getting-started",
];

describe("classifyThreat", () => {
  test("flags every observed probe path", () => {
    for (const p of PROBES) {
      expect(classifyThreat(p), `expected ${p} to be flagged`).not.toBeNull();
    }
  });

  test("does not flag ordinary client paths", () => {
    for (const p of LEGIT) {
      expect(classifyThreat(p), `expected ${p} to be clean`).toBeNull();
    }
  });

  test("returns a stable category label", () => {
    expect(classifyThreat("/.env")).toBe("secret-file");
    expect(classifyThreat("/info.php")).toBe("php-probe");
    expect(classifyThreat("/actuator/env")).toBe("framework-probe");
    expect(classifyThreat("/x?cmd=id")).toBe("cmd-injection");
    expect(isSuspiciousPath("/")).toBe(false);
  });
});

describe("THREAT_SQL_REGEX", () => {
  // The Postgres `~*` regex must agree with the JS classifier (Postgres runs it
  // server-side; here we compile it as a JS RegExp to check parity on the same
  // corpus — the constructs used mean the same thing in both engines).
  const re = new RegExp(THREAT_SQL_REGEX, "i");

  test("matches the same probes", () => {
    for (const p of PROBES) {
      expect(re.test(p), `SQL regex should match ${p}`).toBe(true);
    }
  });

  test("rejects the same legit paths", () => {
    for (const p of LEGIT) {
      expect(re.test(p), `SQL regex should reject ${p}`).toBe(false);
    }
  });
});
