import { describe, expect, it } from "vitest";

import { STACK_FILE_SCHEMA_VERSION, stackFileSchema, type StackFile } from "../schema";

const parse = (s: string) => Bun.YAML.parse(s);
import { applyEngineDefaults } from "../render/apply-defaults";
import { toComposeYaml } from "../render/to-compose";

function minimalPostgresFile(): StackFile {
  return {
    version: STACK_FILE_SCHEMA_VERSION,
    services: {
      primary: {
        env: {
          POSTGRES_USER: "owner",
          POSTGRES_PASSWORD: "pw",
          POSTGRES_DB: "appdb",
        },
        "x-otterdeploy": {
          kind: "database",
          engine: "postgres",
          resourceId: "resource_test_pg",
          projectId: "project_test",
        },
      },
    },
  };
}

describe("stack/schema", () => {
  it("parses a file with only a service + extension block", () => {
    const result = stackFileSchema.safeParse(minimalPostgresFile());
    expect(result.success).toBe(true);
  });

  it("rejects a service missing the x-otterdeploy block", () => {
    const result = stackFileSchema.safeParse({
      version: STACK_FILE_SCHEMA_VERSION,
      services: {
        bad: { image: "nginx" },
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("stack/render/applyEngineDefaults", () => {
  it("fills image, identity env, healthcheck, mount target for postgres", () => {
    const filled = applyEngineDefaults(minimalPostgresFile());
    const service = filled.services["primary"];
    expect(service).toBeDefined();
    if (!service) return;

    expect(service.image).toMatch(/^postgres:/);
    expect(service.env?.["POSTGRES_USER"]).toBe("owner");
    expect(service.env?.["POSTGRES_PASSWORD"]).toBe("pw");
    expect(service.env?.["POSTGRES_DB"]).toBe("appdb");

    expect(service.healthcheck).toBeDefined();
    const test = service.healthcheck?.test;
    const testStr = Array.isArray(test) ? test.join(" ") : (test ?? "");
    expect(testStr).toContain("pg_isready");

    const mount = service.volumes?.find((v) => v.target === "/var/lib/postgresql/data");
    expect(mount).toBeDefined();
    expect(mount?.type).toBe("volume");
  });

  it("leaves a fully-specified file untouched (image present, mount present)", () => {
    const input: StackFile = {
      version: STACK_FILE_SCHEMA_VERSION,
      services: {
        primary: {
          image: "postgres:16-alpine",
          env: { POSTGRES_USER: "u", POSTGRES_PASSWORD: "p", POSTGRES_DB: "d" },
          volumes: [{ type: "volume", source: "v", target: "/var/lib/postgresql/data" }],
          healthcheck: { test: "CMD-SHELL pg_isready -U u -d d" },
          "x-otterdeploy": {
            kind: "database",
            engine: "postgres",
            resourceId: "resource_x",
            projectId: "project_x",
          },
        },
      },
    };
    const out = applyEngineDefaults(input);
    expect(out.services["primary"]?.image).toBe("postgres:16-alpine");
    expect(out.services["primary"]?.volumes?.length).toBe(1);
  });

  it("ignores service-kind entries (no engine)", () => {
    const file: StackFile = {
      version: STACK_FILE_SCHEMA_VERSION,
      services: {
        web: {
          image: "nginx:1",
          "x-otterdeploy": {
            kind: "service",
            resourceId: "resource_web",
            projectId: "project_x",
          },
        },
      },
    };
    const out = applyEngineDefaults(file);
    expect(out.services["web"]?.image).toBe("nginx:1");
    expect(out.services["web"]?.healthcheck).toBeUndefined();
  });
});

describe("stack/render/toComposeYaml", () => {
  it("emits parseable YAML with required compose fields", () => {
    const yaml = toComposeYaml(applyEngineDefaults(minimalPostgresFile()));
    const parsed = parse(yaml) as Record<string, unknown>;
    const services = parsed["services"] as Record<string, unknown> | undefined;
    expect(services).toBeDefined();
    const primary = services?.["primary"] as Record<string, unknown> | undefined;
    expect(primary?.["image"]).toMatch(/^postgres:/);
    expect(primary?.["environment"]).toBeDefined();
    const env = primary?.["environment"] as Record<string, unknown>;
    expect(env["POSTGRES_USER"]).toBe("owner");
  });

  it("projects the otterdeploy extension into deploy.labels", () => {
    const yaml = toComposeYaml(applyEngineDefaults(minimalPostgresFile()));
    expect(yaml).toContain("otterdeploy.kind: database");
    expect(yaml).toContain("otterdeploy.engine: postgres");
    expect(yaml).toContain("otterdeploy.resource.id: resource_test_pg");
    expect(yaml).toContain("otterdeploy.project.id: project_test");
  });

  it("is byte-deterministic for structurally identical inputs", () => {
    const a = toComposeYaml(applyEngineDefaults(minimalPostgresFile()));
    const b = toComposeYaml(applyEngineDefaults(minimalPostgresFile()));
    expect(a).toBe(b);

    // Reordering keys in the source object should NOT change the emitted
    // YAML — keys are alpha-sorted on the way out.
    const reordered: StackFile = {
      services: minimalPostgresFile().services,
      version: STACK_FILE_SCHEMA_VERSION,
    };
    const c = toComposeYaml(applyEngineDefaults(reordered));
    expect(c).toBe(a);
  });

  it("round-trips: rendered → YAML → parsed compose carries identity in deploy.labels", () => {
    // The renderer projects the x-otterdeploy identity into deploy.labels (pure
    // compose — nothing parses our output back in), NOT an x-otterdeploy block.
    // Assert it survives the full render → YAML → parse round-trip as structured
    // labels (the string form is covered by the projection test above).
    const file = applyEngineDefaults(minimalPostgresFile());
    const yaml = toComposeYaml(file);
    const parsed = parse(yaml) as { services: Record<string, unknown> };
    const primary = parsed.services["primary"] as Record<string, unknown>;
    expect(primary["x-otterdeploy"]).toBeUndefined();
    const deploy = primary["deploy"] as Record<string, unknown>;
    const labels = deploy["labels"] as Record<string, unknown>;
    expect(labels["otterdeploy.kind"]).toBe("database");
    expect(labels["otterdeploy.engine"]).toBe("postgres");
    expect(labels["otterdeploy.resource.id"]).toBe("resource_test_pg");
    expect(labels["otterdeploy.project.id"]).toBe("project_test");
  });
});
