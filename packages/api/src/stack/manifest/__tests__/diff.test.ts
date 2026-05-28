import { describe, expect, it } from "vitest";

import { diffManifest, type CurrentState } from "../diff";
import { manifestSchema, type Manifest } from "../schema";

const empty: CurrentState = { services: {}, databases: {} };

function manifest(input: unknown): Manifest {
  return manifestSchema.parse(input);
}

describe("diffManifest", () => {
  it("plans creates for every resource against an empty project", () => {
    const m = manifest({
      project: "acme-api",
      services: {
        web: { source: "image", image: "ghcr.io/acme/api:1.0.0" },
      },
      databases: {
        primary: { engine: "postgres", version: "16" },
      },
    });
    const changes = diffManifest(m, empty);
    expect(changes).toEqual([
      {
        kind: "create",
        resource: "service",
        name: "web",
        details: { source: "image", replicas: 1, image: "ghcr.io/acme/api:1.0.0" },
      },
      {
        kind: "create",
        resource: "database",
        name: "primary",
        details: { engine: "postgres", version: "16" },
      },
    ]);
  });

  it("plans deletes for resources missing from the manifest", () => {
    const m = manifest({ project: "acme-api" });
    const current: CurrentState = {
      services: {
        old: {
          name: "old",
          source: "image",
          image: "x",
          sourceSubdir: null,
          replicas: 1,
          command: null,
          entrypoint: null,
          ports: [],
          env: {},
          publicEnabled: false,
        },
      },
      databases: {},
    };
    expect(diffManifest(m, current)).toEqual([
      { kind: "delete", resource: "service", name: "old" },
    ]);
  });

  it("emits no-op when manifest and current are equivalent", () => {
    const m = manifest({
      project: "acme-api",
      services: {
        web: { source: "image", image: "ghcr.io/acme/api:1.0.0", replicas: 2 },
      },
    });
    const current: CurrentState = {
      services: {
        web: {
          name: "web",
          source: "image",
          image: "ghcr.io/acme/api:1.0.0",
          sourceSubdir: null,
          replicas: 2,
          command: null,
          entrypoint: null,
          ports: [],
          env: {},
          publicEnabled: false,
        },
      },
      databases: {},
    };
    expect(diffManifest(m, current)).toEqual([
      { kind: "no-op", resource: "service", name: "web" },
    ]);
  });

  it("plans update for image change and env diff", () => {
    const m = manifest({
      project: "acme-api",
      services: {
        web: {
          source: "image",
          image: "ghcr.io/acme/api:2.0.0",
          replicas: 1,
          env: { LOG_LEVEL: "warn", DATABASE_URL: "${secret}" },
        },
      },
    });
    const current: CurrentState = {
      services: {
        web: {
          name: "web",
          source: "image",
          image: "ghcr.io/acme/api:1.0.0",
          sourceSubdir: null,
          replicas: 1,
          command: null,
          entrypoint: null,
          ports: [],
          env: { LOG_LEVEL: "info", DEPRECATED: "x" },
          publicEnabled: false,
        },
      },
      databases: {},
    };
    const changes = diffManifest(m, current);
    expect(changes).toContainEqual({
      kind: "update",
      resource: "service",
      name: "web",
      details: {
        fields: {
          image: { from: "ghcr.io/acme/api:1.0.0", to: "ghcr.io/acme/api:2.0.0" },
        },
      },
    });
    expect(changes).toContainEqual({
      kind: "update",
      resource: "env",
      name: "web.LOG_LEVEL",
      details: { from: "info", to: "warn" },
    });
    // ${secret} declared but missing server-side → create with a note
    expect(changes).toContainEqual({
      kind: "create",
      resource: "env",
      name: "web.DATABASE_URL",
      details: {
        secret: true,
        note: expect.stringContaining("declared as ${secret}"),
      },
    });
    // unmanaged DEPRECATED key should be planned for deletion
    expect(changes).toContainEqual({
      kind: "delete",
      resource: "env",
      name: "web.DEPRECATED",
    });
  });

  it("represents discriminator change as delete + create", () => {
    const m = manifest({
      project: "acme-api",
      services: {
        web: { source: "git", sourceSubdir: "apps/web" },
      },
    });
    const current: CurrentState = {
      services: {
        web: {
          name: "web",
          source: "image",
          image: "ghcr.io/acme/api:1.0.0",
          sourceSubdir: null,
          replicas: 1,
          command: null,
          entrypoint: null,
          ports: [],
          env: {},
          publicEnabled: false,
        },
      },
      databases: {},
    };
    const changes = diffManifest(m, current);
    expect(changes[0]).toMatchObject({ kind: "delete", resource: "service", name: "web" });
    expect(changes[1]).toMatchObject({ kind: "create", resource: "service", name: "web" });
  });
});
