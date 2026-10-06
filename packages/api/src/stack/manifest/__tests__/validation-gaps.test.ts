/**
 * Manifest validation catches the misconfigurations that used to surface as a
 * deploy-time or apply-time failure.
 *
 * The manifest is the declarative source of truth, so "it parsed" is the
 * promise that applying it is a reasonable thing to attempt. Each case below
 * parsed cleanly and then failed later, somewhere that could not name the
 * field responsible:
 *
 *   - a port above the TCP/UDP range reached docker, which rejected it;
 *   - two primary ports, or a repeated port, made the public route target
 *     depend on array order;
 *   - a name reused across the services/databases/composes maps hit the
 *     `resource` unique index MID-APPLY. Databases run in phase 1 and services
 *     later, and apply is not transactional across phases, so the database was
 *     created and the service then died on a raw postgres constraint error,
 *     leaving the project half-applied.
 *
 * All of these are decidable from the document alone, which is why they belong
 * at the parse boundary. Ref TARGETS deliberately are not checked here: refs
 * resolve through `loadRefTable`, which reads every resource in the project, so
 * a ref may legitimately point at something the manifest never declares.
 */
import { describe, expect, it } from "vite-plus/test";

import { manifestSchema } from "../schema";

const imageService = (extra: Record<string, unknown> = {}) => ({
  source: "image",
  image: "nginx",
  ...extra,
});

function parse(document: Record<string, unknown>) {
  return manifestSchema.safeParse({ project: "proj_test", ...document });
}

/** Every message a failed parse produced, joined for substring assertions. */
function messages(document: Record<string, unknown>): string {
  const result = parse(document);
  if (result.success) return "";
  return result.error.issues.map((issue) => issue.message).join("\n");
}

describe("resource names share one namespace", () => {
  it("rejects a name used by both a service and a database", () => {
    const result = parse({
      services: { api: imageService() },
      databases: { api: { engine: "postgres" } },
    });
    expect(result.success).toBe(false);
    expect(
      messages({ services: { api: imageService() }, databases: { api: { engine: "postgres" } } }),
    ).toContain('"api" is declared as a service and a database');
  });

  it("rejects a name used by both a service and a compose stack", () => {
    expect(
      messages({
        services: { api: imageService() },
        composes: { api: { source: "inline", content: "services: {}" } },
      }),
    ).toContain("a compose stack");
  });

  it("names the environment when the collision is introduced by an override", () => {
    // Base is clean: `api` is only a database. The staging block adds a service
    // by the same name, so staging — and only staging — cannot be applied.
    const result = parse({
      databases: { api: { engine: "postgres" } },
      environments: { staging: { services: { api: { image: "nginx" } } } },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.message.includes('"api"'));
    expect(issue?.path).toEqual(["environments", "staging"]);
  });

  it("allows a name the environment freed with null before reusing it", () => {
    // `null` removes a resource from an environment, so staging genuinely has
    // no `api` database and the service does not collide with anything.
    const result = parse({
      databases: { api: { engine: "postgres" } },
      environments: {
        staging: {
          databases: { api: null },
          services: { api: { source: "image", image: "nginx" } },
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("leaves a manifest whose names are distinct alone", () => {
    expect(
      parse({
        services: { web: imageService() },
        databases: { db: { engine: "postgres" } },
        composes: { stack: { source: "inline", content: "services: {}" } },
      }).success,
    ).toBe(true);
  });
});

describe("port declarations", () => {
  it("rejects a port outside the TCP/UDP range", () => {
    expect(
      parse({ services: { a: imageService({ ports: [{ container: 70_000 }] }) } }).success,
    ).toBe(false);
    // The boundary itself stays valid.
    expect(
      parse({ services: { a: imageService({ ports: [{ container: 65_535 }] }) } }).success,
    ).toBe(true);
  });

  it("rejects a second primary port, because the route target would depend on order", () => {
    expect(
      messages({
        services: {
          a: imageService({
            ports: [
              { container: 80, primary: true },
              { container: 81, primary: true },
            ],
          }),
        },
      }),
    ).toContain("exactly one port can be primary");
  });

  it("accepts exactly one primary port", () => {
    expect(
      parse({
        services: {
          a: imageService({ ports: [{ container: 80, primary: true }, { container: 81 }] }),
        },
      }).success,
    ).toBe(true);
  });

  it("rejects the same container port declared twice", () => {
    expect(
      messages({
        services: { a: imageService({ ports: [{ container: 80 }, { container: 80 }] }) },
      }),
    ).toContain("declares container port 80 twice");
  });

  it("rejects two ports sharing a name, which would make a port ref ambiguous", () => {
    // `${service:a.port.web}` has to select one port.
    expect(
      messages({
        services: {
          a: imageService({
            ports: [
              { container: 80, name: "web" },
              { container: 81, name: "web" },
            ],
          }),
        },
      }),
    ).toContain('two ports named "web"');
  });

  it("does not confuse two unnamed ports for a duplicate name", () => {
    expect(
      parse({ services: { a: imageService({ ports: [{ container: 80 }, { container: 81 }] }) } })
        .success,
    ).toBe(true);
  });
});

describe("resource limits", () => {
  it("rejects a reservation above its limit, which docker refuses at deploy", () => {
    // "Minimum memory limit can not be less than memory reservation limit".
    expect(
      messages({
        services: { a: imageService({ resources: { memoryMb: 512, memoryReservationMb: 2048 } }) },
      }),
    ).toContain("cannot exceed memoryMb");
    expect(
      messages({
        services: { a: imageService({ resources: { cpuLimit: 1, cpuReservation: 8 } }) },
      }),
    ).toContain("cannot exceed cpuLimit");
  });

  it("accepts a reservation at or below its limit", () => {
    expect(
      parse({
        services: {
          a: imageService({
            resources: {
              cpuLimit: 4,
              cpuReservation: 4,
              memoryMb: 2048,
              memoryReservationMb: 1024,
            },
          }),
        },
      }).success,
    ).toBe(true);
  });

  it("rejects magnitudes that can only be a unit mix-up", () => {
    // Bytes entered where megabytes were meant.
    expect(
      parse({ services: { a: imageService({ resources: { memoryMb: 1e15 } }) } }).success,
    ).toBe(false);
    expect(parse({ services: { a: imageService({ replicas: 1_000_000 }) } }).success).toBe(false);
  });

  it("keeps the values that mean something specific", () => {
    // 0 replicas is a deliberate scale-to-zero, and cpuLimit 0 is docker's
    // "no limit" — neither is a mistake, so neither may be rejected.
    expect(parse({ services: { a: imageService({ replicas: 0 }) } }).success).toBe(true);
    expect(parse({ services: { a: imageService({ resources: { cpuLimit: 0 } }) } }).success).toBe(
      true,
    );
  });
});

describe("healthchecks", () => {
  it("rejects a healthcheck with no command", () => {
    // An empty `cmd` would make docker inherit the image's healthcheck, which is
    // not what declaring an empty list says. Silence is worse than a refusal.
    expect(parse({ services: { a: imageService({ healthcheck: { cmd: [] } }) } }).success).toBe(
      false,
    );
  });

  it("rejects timings that can only be seconds-typed-as-milliseconds", () => {
    expect(
      parse({
        services: { a: imageService({ healthcheck: { cmd: ["true"], intervalMs: 86_400_000 } }) },
      }).success,
    ).toBe(false);
  });

  it("accepts an ordinary healthcheck", () => {
    expect(
      parse({
        services: {
          a: imageService({
            healthcheck: { cmd: ["curl", "-f", "http://localhost/health"], intervalMs: 10_000 },
          }),
        },
      }).success,
    ).toBe(true);
  });
});

describe("compose stacks", () => {
  it("bounds the exposed port the same way a service port is bounded", () => {
    // This is the port a public route is pointed at.
    expect(
      parse({
        composes: {
          stack: {
            source: "inline",
            content: "services: {}",
            exposed: [{ service: "web", port: 70_000 }],
          },
        },
      }).success,
    ).toBe(false);
  });
});
