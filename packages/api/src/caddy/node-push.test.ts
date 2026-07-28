import { describe, expect, test } from "vite-plus/test";

import {
  caddyfileRevision,
  NODE_EDGE_DIR,
  nodePushScript,
  PUSH_INVALID_EXIT,
  PUSH_NO_PROXY_EXIT,
  PUSH_UNCHANGED_EXIT,
} from "./node-push";

const CADDYFILE = ':80 {\n  respond "hi" 200\n}\n';

describe("nodePushScript", () => {
  const script = nodePushScript(CADDYFILE);

  test("validates before the live file is replaced", () => {
    // The whole point of the module. If the swap ever precedes validation, a
    // rejected config sits on disk and breaks the edge on next container
    // restart — hours after the change that caused it.
    const validateAt = script.indexOf("caddy validate");
    const swapAt = script.indexOf(`mv ${NODE_EDGE_DIR}/Caddyfile.next`);
    expect(validateAt).toBeGreaterThan(-1);
    expect(swapAt).toBeGreaterThan(-1);
    expect(validateAt).toBeLessThan(swapAt);
  });

  test("validates the side file, never the live one", () => {
    expect(script).toContain("caddy validate --config /etc/caddy/Caddyfile.next");
  });

  test("reloads only after the swap", () => {
    expect(script.indexOf(`mv ${NODE_EDGE_DIR}/Caddyfile.next`)).toBeLessThan(
      script.indexOf("caddy reload"),
    );
  });

  test("removes the side file when validation fails", () => {
    // Otherwise a stale .next lingers and the next push's validate could pass
    // against content nobody intended to ship.
    const failureBlock = script.slice(script.indexOf("rejected by caddy validate"));
    expect(failureBlock).toContain(`rm -f ${NODE_EDGE_DIR}/Caddyfile.next`);
    expect(failureBlock).toContain(`exit ${PUSH_INVALID_EXIT}`);
  });

  test("exits early when the config is byte-identical", () => {
    expect(script).toContain(`exit ${PUSH_UNCHANGED_EXIT}`);
    // The skip must be decided before anything is written.
    expect(script.indexOf(`exit ${PUSH_UNCHANGED_EXIT}`)).toBeLessThan(
      script.indexOf("Caddyfile.next"),
    );
  });

  test("bails out when the node has no edge proxy", () => {
    expect(script).toContain(`exit ${PUSH_NO_PROXY_EXIT}`);
    expect(script.indexOf("docker inspect")).toBeLessThan(script.indexOf("mkdir -p"));
  });

  test("ships the config base64-encoded so quoting can't corrupt it", () => {
    // A Caddyfile is full of braces and quotes; interpolating it into a shell
    // command would mangle it.
    expect(script).toContain(Buffer.from(CADDYFILE, "utf8").toString("base64"));
    expect(script).not.toContain('respond "hi" 200');
  });

  test("prefixes privileged commands with sudo when asked", () => {
    const sudoScript = nodePushScript(CADDYFILE, "sudo");
    expect(sudoScript).toContain("sudo docker exec");
    expect(sudoScript).toContain(`sudo mv ${NODE_EDGE_DIR}/Caddyfile.next`);
  });

  test("runs unprefixed as root", () => {
    expect(script).toContain("docker exec");
    expect(script).not.toContain("sudo ");
  });

  test("aborts on the first failing step", () => {
    expect(script.startsWith("set -euo pipefail")).toBe(true);
  });

  test("hashing the current file tolerates it not existing yet", () => {
    // First push has no file; `set -e` would abort without the guard.
    const line = script.split("\n").find((l) => l.includes("sha256sum") && l.includes("CURRENT"));
    expect(line).toContain("|| true");
  });
});

describe("caddyfileRevision", () => {
  test("is stable for identical content", () => {
    expect(caddyfileRevision(CADDYFILE)).toBe(caddyfileRevision(CADDYFILE));
  });

  test("changes when the config changes", () => {
    expect(caddyfileRevision(CADDYFILE)).not.toBe(caddyfileRevision(`${CADDYFILE}\n:81 {}\n`));
  });
});
