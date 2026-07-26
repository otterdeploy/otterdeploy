/**
 * od-5j8.24 — explicit Compose compatibility, no silent drops.
 *
 * Invariant under test: every security- or data-relevant Compose field the
 * platform can't fully honor is CAPTURED by the parser (never silently
 * discarded — see `stack/compose/types.ts` / `normalize.ts`) and then
 * CLASSIFIED by `checkComposeCompatibility` as either a hard failure
 * (blocks the deploy) or a warning (surfaced, deploy proceeds) — never a
 * silent no-op. `privileged`, `cap_add`, `devices`, an escalating
 * `security_opt`, any `network_mode` override, `pid: host`, and an
 * unresolvable bind mount are hostile/unsafe inputs that must FAIL. Inert
 * or already-covered fields (`cap_drop`, a benign `security_opt`, `sysctls`,
 * `ulimits`, per-service `secrets`/`configs`, a resolvable bind mount) must
 * WARN, not fail — the deploy still proceeds for those.
 */
import { describe, expect, test } from "vite-plus/test";

import { checkComposeCompatibility } from "../../stack/compose/compatibility";
import { parseCompose } from "../../stack/compose/parse";

function parse(yaml: string) {
  const r = parseCompose(yaml);
  if (r.isErr()) throw new Error(`fixture failed to parse: ${r.error.message}`);
  return r.value;
}

function fieldsOf(report: ReturnType<typeof checkComposeCompatibility>, severity: "fail" | "warn") {
  return (severity === "fail" ? report.fails : report.warnings).map((i) => i.field);
}

describe("[od-5j8.24] normalize — nothing is silently dropped (captured on ParsedComposeService)", () => {
  test("privileged, cap_add, cap_drop, devices, security_opt, network_mode, pid, sysctls, ulimits, secrets, configs all survive parsing", () => {
    const parsed = parse(`
services:
  hostile:
    image: alpine
    privileged: true
    cap_add: ["SYS_ADMIN"]
    cap_drop: ["NET_RAW"]
    devices: ["/dev/kvm:/dev/kvm"]
    security_opt: ["seccomp:unconfined"]
    network_mode: host
    pid: host
    sysctls:
      net.core.somaxconn: "1024"
    ulimits:
      nofile:
        soft: 1024
        hard: 2048
    secrets: ["db_password"]
    configs: ["app_config"]
`);
    const svc = parsed.services[0];
    expect(svc).toBeDefined();
    if (!svc) return;
    expect(svc.privileged).toBe(true);
    expect(svc.capAdd).toEqual(["SYS_ADMIN"]);
    expect(svc.capDrop).toEqual(["NET_RAW"]);
    expect(svc.devices).toEqual(["/dev/kvm:/dev/kvm"]);
    expect(svc.securityOpt).toEqual(["seccomp:unconfined"]);
    expect(svc.networkMode).toBe("host");
    expect(svc.pid).toBe("host");
    expect(svc.sysctls).toEqual({ "net.core.somaxconn": "1024" });
    expect(svc.hasUlimits).toBe(true);
    expect(svc.secrets).toEqual(["db_password"]);
    expect(svc.configs).toEqual(["app_config"]);
  });

  test("profiles still warn (pre-existing, unchanged) — acceptance-list coverage", () => {
    const parsed = parse(`
services:
  web:
    image: nginx:latest
    profiles: ["debug"]
`);
    expect(parsed.warnings.some((w) => w.includes("profiles"))).toBe(true);
  });

  test("deploy.resources.limits and healthcheck (health) still parse alongside the new fields — acceptance-list coverage", () => {
    const parsed = parse(`
services:
  web:
    image: nginx:latest
    networks: ["front", "back"]
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost/"]
      interval: 10s
      retries: 3
    deploy:
      resources:
        limits:
          cpus: "0.5"
          memory: 256m
`);
    const svc = parsed.services[0];
    expect(svc).toBeDefined();
    if (!svc) return;
    expect(svc.networks).toEqual(["front", "back"]);
    expect(svc.healthcheck?.test).toEqual(["CMD", "curl", "-f", "http://localhost/"]);
    expect(svc.resources).toEqual({ cpus: "0.5", memoryMb: 256 });
    // None of this trips the compatibility report — fully-supported fields.
    const report = checkComposeCompatibility(parsed, { bindMountsSupported: false });
    expect(report).toEqual({ fails: [], warnings: [], ok: true });
  });

  test("a benign service (none of the above set) reports all-false/empty — no false positives", () => {
    const parsed = parse(`
services:
  web:
    image: nginx:latest
`);
    const svc = parsed.services[0];
    expect(svc).toBeDefined();
    if (!svc) return;
    expect(svc.privileged).toBe(false);
    expect(svc.capAdd).toEqual([]);
    expect(svc.devices).toEqual([]);
    expect(svc.securityOpt).toEqual([]);
    expect(svc.networkMode).toBeNull();
    expect(svc.pid).toBeNull();
    expect(svc.hasUlimits).toBe(false);
  });
});

describe("[od-5j8.24] checkComposeCompatibility — FAIL matrix (safety-impacting, blocks deploy)", () => {
  const ctx = { bindMountsSupported: true };

  test("privileged: true fails", () => {
    const parsed = parse(`
services:
  hostile:
    image: alpine
    privileged: true
`);
    const report = checkComposeCompatibility(parsed, ctx);
    expect(report.ok).toBe(false);
    expect(fieldsOf(report, "fail")).toContain("privileged");
  });

  test("cap_add (any capability) fails", () => {
    const parsed = parse(`
services:
  hostile:
    image: alpine
    cap_add: ["NET_ADMIN"]
`);
    const report = checkComposeCompatibility(parsed, ctx);
    expect(report.ok).toBe(false);
    expect(fieldsOf(report, "fail")).toContain("cap_add");
  });

  test("devices fails", () => {
    const parsed = parse(`
services:
  hostile:
    image: alpine
    devices: ["/dev/kvm:/dev/kvm"]
`);
    const report = checkComposeCompatibility(parsed, ctx);
    expect(report.ok).toBe(false);
    expect(fieldsOf(report, "fail")).toContain("devices");
  });

  test.each([
    "seccomp:unconfined",
    "apparmor:unconfined",
    "no-new-privileges:false",
    "label:disable",
  ])("security_opt escalation '%s' fails", (opt) => {
    const parsed = parse(`
services:
  hostile:
    image: alpine
    security_opt: ["${opt}"]
`);
    const report = checkComposeCompatibility(parsed, ctx);
    expect(report.ok).toBe(false);
    expect(fieldsOf(report, "fail")).toContain("security_opt");
  });

  test.each(["host", "none", "bridge", "container:other", "service:db"])(
    "network_mode: %s fails (Swarm services can't honor any override)",
    (mode) => {
      const parsed = parse(`
services:
  hostile:
    image: alpine
    network_mode: "${mode}"
`);
      const report = checkComposeCompatibility(parsed, ctx);
      expect(report.ok).toBe(false);
      expect(fieldsOf(report, "fail")).toContain("network_mode");
    },
  );

  test("pid: host fails", () => {
    const parsed = parse(`
services:
  hostile:
    image: alpine
    pid: host
`);
    const report = checkComposeCompatibility(parsed, ctx);
    expect(report.ok).toBe(false);
    expect(fieldsOf(report, "fail")).toContain("pid");
  });

  test("bind mount fails when the stack can't materialize a host path (single-file/git-sourced)", () => {
    const parsed = parse(`
services:
  hostile:
    image: alpine
    volumes:
      - /etc/passwd:/host/etc/passwd
`);
    const report = checkComposeCompatibility(parsed, { bindMountsSupported: false });
    expect(report.ok).toBe(false);
    expect(fieldsOf(report, "fail")).toContain("volumes");
  });

  test("a hostile file with multiple unsafe fields at once reports every one of them, not just the first", () => {
    const parsed = parse(`
services:
  hostile:
    image: alpine
    privileged: true
    cap_add: ["SYS_ADMIN"]
    devices: ["/dev/kvm:/dev/kvm"]
    network_mode: host
    security_opt: ["apparmor:unconfined"]
`);
    const report = checkComposeCompatibility(parsed, ctx);
    expect(report.ok).toBe(false);
    const fields = fieldsOf(report, "fail");
    expect(fields).toContain("privileged");
    expect(fields).toContain("cap_add");
    expect(fields).toContain("devices");
    expect(fields).toContain("network_mode");
    expect(fields).toContain("security_opt");
    expect(report.fails.length).toBeGreaterThanOrEqual(5);
  });
});

describe("[od-5j8.24] checkComposeCompatibility — WARN matrix (surfaced, deploy proceeds)", () => {
  const ctx = { bindMountsSupported: true };

  test("cap_drop warns, doesn't fail", () => {
    const parsed = parse(`
services:
  db:
    image: postgres:16
    cap_drop: ["NET_RAW"]
`);
    const report = checkComposeCompatibility(parsed, ctx);
    expect(report.ok).toBe(true);
    expect(fieldsOf(report, "warn")).toContain("cap_drop");
  });

  test.each(["no-new-privileges:true", "seccomp:default", "apparmor:docker-default"])(
    "benign security_opt '%s' warns, doesn't fail",
    (opt) => {
      const parsed = parse(`
services:
  web:
    image: nginx:latest
    security_opt: ["${opt}"]
`);
      const report = checkComposeCompatibility(parsed, ctx);
      expect(report.ok).toBe(true);
      expect(fieldsOf(report, "warn")).toContain("security_opt");
    },
  );

  test("sysctls warns, doesn't fail", () => {
    const parsed = parse(`
services:
  web:
    image: nginx:latest
    sysctls:
      net.core.somaxconn: "1024"
`);
    const report = checkComposeCompatibility(parsed, ctx);
    expect(report.ok).toBe(true);
    expect(fieldsOf(report, "warn")).toContain("sysctls");
  });

  test("ulimits warns, doesn't fail", () => {
    const parsed = parse(`
services:
  web:
    image: nginx:latest
    ulimits:
      nofile: 1024
`);
    const report = checkComposeCompatibility(parsed, ctx);
    expect(report.ok).toBe(true);
    expect(fieldsOf(report, "warn")).toContain("ulimits");
  });

  test("per-service secrets/configs warn, don't fail", () => {
    const parsed = parse(`
services:
  web:
    image: nginx:latest
    secrets: ["db_password"]
    configs: ["app_config"]
`);
    const report = checkComposeCompatibility(parsed, ctx);
    expect(report.ok).toBe(true);
    expect(fieldsOf(report, "warn")).toContain("secrets");
    expect(fieldsOf(report, "warn")).toContain("configs");
  });

  test("a bind mount warns (not fails) when the stack CAN materialize a host path", () => {
    const parsed = parse(`
services:
  web:
    image: nginx:latest
    volumes:
      - ./html:/usr/share/nginx/html
`);
    const report = checkComposeCompatibility(parsed, { bindMountsSupported: true });
    expect(report.ok).toBe(true);
    expect(fieldsOf(report, "warn")).toContain("volumes");
  });

  test("a named volume mount is neither a fail nor a warn (fully supported, honored elsewhere)", () => {
    const parsed = parse(`
services:
  db:
    image: postgres:16
    volumes:
      - pgdata:/var/lib/postgresql/data
`);
    const report = checkComposeCompatibility(parsed, { bindMountsSupported: false });
    expect(report.ok).toBe(true);
    expect(report.warnings).toEqual([]);
  });

  test("an entirely benign compose file produces an empty report", () => {
    const parsed = parse(`
services:
  web:
    image: nginx:latest
    ports: ["3000:3000"]
  db:
    image: postgres:16
    volumes:
      - pgdata:/var/lib/postgresql/data
`);
    const report = checkComposeCompatibility(parsed, { bindMountsSupported: false });
    expect(report).toEqual({ fails: [], warnings: [], ok: true });
  });
});
