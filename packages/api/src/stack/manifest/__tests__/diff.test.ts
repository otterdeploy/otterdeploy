import { describe, expect, it } from "vite-plus/test";

import { diffManifest, type CurrentState } from "../diff";
import { manifestSchema, type Manifest } from "../schema";

const empty: CurrentState = { services: {}, databases: {}, composes: {} };

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
          repo: null,
          branch: null,
          imageRepository: null,
          replicas: 1,
          command: null,
          entrypoint: null,
          ports: [],
          env: {},
          publicEnabled: false,
          previewsEnabled: false,
          preDeploy: null,
          postDeploy: null,
          buildConfig: null,
          restartWindowMs: null,
          diskLimitMb: null,
          swapLimitMb: null,
          pidsLimit: null,
        },
      },
      databases: {},
      composes: {},
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
          repo: null,
          branch: null,
          imageRepository: null,
          replicas: 2,
          command: null,
          entrypoint: null,
          ports: [],
          env: {},
          publicEnabled: false,
          previewsEnabled: false,
          preDeploy: null,
          postDeploy: null,
          buildConfig: null,
          restartWindowMs: null,
          diskLimitMb: null,
          swapLimitMb: null,
          pidsLimit: null,
        },
      },
      databases: {},
      composes: {},
    };
    expect(diffManifest(m, current)).toEqual([{ kind: "no-op", resource: "service", name: "web" }]);
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
          repo: null,
          branch: null,
          imageRepository: null,
          replicas: 1,
          command: null,
          entrypoint: null,
          ports: [],
          env: { LOG_LEVEL: "info", DEPRECATED: "x" },
          publicEnabled: false,
          previewsEnabled: false,
          preDeploy: null,
          postDeploy: null,
          buildConfig: null,
          restartWindowMs: null,
          diskLimitMb: null,
          swapLimitMb: null,
          pidsLimit: null,
        },
      },
      databases: {},
      composes: {},
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
      details: { from: "info", to: "warn", parent: "service", key: "LOG_LEVEL", owner: "web" },
    });
    // ${secret} declared but missing server-side → create with a note
    expect(changes).toContainEqual({
      kind: "create",
      resource: "env",
      name: "web.DATABASE_URL",
      details: {
        secret: true,
        note: expect.stringContaining("declared as ${secret}"),
        parent: "service",
        key: "DATABASE_URL",
        owner: "web",
      },
    });
    // unmanaged DEPRECATED key should be planned for deletion
    expect(changes).toContainEqual({
      kind: "delete",
      resource: "env",
      name: "web.DEPRECATED",
      details: { parent: "service", key: "DEPRECATED", owner: "web" },
    });
  });

  it("plans a create for a compose stack absent from current state", () => {
    const m = manifest({
      project: "acme-api",
      composes: {
        web: {
          source: "inline",
          content: "services:\n  app:\n    image: nginx\n",
          exposed: [{ service: "app", port: 80 }],
        },
      },
    });
    expect(diffManifest(m, empty)).toEqual([
      {
        kind: "create",
        resource: "compose",
        name: "web",
        details: { source: "inline", exposed: ["app:80"] },
      },
    ]);
  });

  it("emits no-op for a compose stack that already exists; never a delete", () => {
    const m = manifest({ project: "acme-api" });
    const current: CurrentState = {
      services: {},
      databases: {},
      composes: { web: { name: "web" } },
    };
    // Stack exists in current but not the manifest → intentionally NO change
    // (deletion stays on the stack's own action, not the manifest diff).
    expect(diffManifest(m, current)).toEqual([]);
  });

  it("round-trip: a fully-applied manifest diffs to only no-ops", () => {
    // THE invariant behind the draft panel: right after an Apply, the diff
    // must be empty. Any field whose diff/apply semantics disagree (e.g. an
    // absent key defaulted on one side but not the other) breaks this.
    const m = manifest({
      project: "acme-api",
      services: {
        web: { source: "image", image: "ghcr.io/acme/api:1.0.0", replicas: 2, env: { A: "1" } },
      },
      databases: {
        primary: { engine: "postgres", publicEnabled: true, extraEnv: { B: "2" } },
      },
    });
    const current: CurrentState = {
      services: {
        web: {
          name: "web",
          source: "image",
          image: "ghcr.io/acme/api:1.0.0",
          sourceSubdir: null,
          repo: null,
          branch: null,
          imageRepository: null,
          replicas: 2,
          command: null,
          entrypoint: null,
          ports: [],
          env: { A: "1" },
          publicEnabled: false,
          previewsEnabled: false,
          preDeploy: null,
          postDeploy: null,
          buildConfig: null,
          restartWindowMs: null,
          diskLimitMb: null,
          swapLimitMb: null,
          pidsLimit: null,
        },
      },
      databases: {
        primary: {
          name: "primary",
          engine: "postgres",
          publicEnabled: true,
          previewBranching: false,
          extraEnv: { B: "2" },
        },
      },
      composes: {},
    };
    const changes = diffManifest(m, current);
    expect(changes.filter((c) => c.kind !== "no-op")).toEqual([]);
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
          repo: null,
          branch: null,
          imageRepository: null,
          replicas: 1,
          command: null,
          entrypoint: null,
          ports: [],
          env: {},
          publicEnabled: false,
          previewsEnabled: false,
          preDeploy: null,
          postDeploy: null,
          buildConfig: null,
          restartWindowMs: null,
          diskLimitMb: null,
          swapLimitMb: null,
          pidsLimit: null,
        },
      },
      databases: {},
      composes: {},
    };
    const changes = diffManifest(m, current);
    expect(changes[0]).toMatchObject({ kind: "delete", resource: "service", name: "web" });
    expect(changes[1]).toMatchObject({ kind: "create", resource: "service", name: "web" });
  });
});

// Fields the manifest manages only when it DECLARES them. An omitted key
// means "the live editor owns this" — the diff must never manufacture a
// change from an absent key. Regression suite for the phantom-revert bug:
// a live public-toggle (or live env edit) used to be staged as an update /
// delete seconds later and REVERTED by the next Apply.
describe("diffDatabase declared-only fields", () => {
  function currentDb(over: Partial<CurrentState["databases"][string]> = {}) {
    return {
      databases: {
        primary: {
          name: "primary",
          engine: "postgres" as const,
          publicEnabled: false,
          previewBranching: false,
          extraEnv: {},
          ...over,
        },
      },
      services: {},
      composes: {},
    } satisfies CurrentState;
  }

  it("absent publicEnabled never diffs a live toggle", () => {
    const m = manifest({ project: "acme-api", databases: { primary: { engine: "postgres" } } });
    expect(diffManifest(m, currentDb({ publicEnabled: true }))).toEqual([
      { kind: "no-op", resource: "database", name: "primary" },
    ]);
  });

  it("absent extraEnv never stages deletes of live-added keys", () => {
    const m = manifest({ project: "acme-api", databases: { primary: { engine: "postgres" } } });
    expect(diffManifest(m, currentDb({ extraEnv: { SHARED_BUFFERS: "256MB" } }))).toEqual([
      { kind: "no-op", resource: "database", name: "primary" },
    ]);
  });

  it("declared publicEnabled equal to live state is a no-op", () => {
    const m = manifest({
      project: "acme-api",
      databases: { primary: { engine: "postgres", publicEnabled: true } },
    });
    expect(diffManifest(m, currentDb({ publicEnabled: true }))).toEqual([
      { kind: "no-op", resource: "database", name: "primary" },
    ]);
  });

  it("declared publicEnabled that differs stages an update", () => {
    const m = manifest({
      project: "acme-api",
      databases: { primary: { engine: "postgres", publicEnabled: false } },
    });
    expect(diffManifest(m, currentDb({ publicEnabled: true }))).toEqual([
      {
        kind: "update",
        resource: "database",
        name: "primary",
        details: { fields: { publicEnabled: { from: true, to: false } } },
      },
    ]);
  });

  it("declared extraEnv that differs stages env changes (including deletes)", () => {
    const m = manifest({
      project: "acme-api",
      databases: { primary: { engine: "postgres", extraEnv: { KEEP: "1" } } },
    });
    const changes = diffManifest(m, currentDb({ extraEnv: { KEEP: "1", DROP: "x" } }));
    expect(changes).toContainEqual({
      kind: "delete",
      resource: "env",
      name: "primary.DROP",
      details: { parent: "database", key: "DROP", owner: "primary" },
    });
  });
});

// ── Declared-only convention: live-managed service fields/env ──────────────
//
// A field or env map the manifest OMITS is live-managed — the panels/env
// editor own it and the diff must not stage phantom changes for it. These
// are regressions from the "un-appliable diff" class: the diff staged
// changes apply's patch builders never carried, so the pending bar showed
// (and re-showed) work that could never complete.
describe("declared-only service fields and env", () => {
  function liveService(over: Partial<CurrentState["services"][string]> = {}): CurrentState {
    return {
      services: {
        web: {
          name: "web",
          source: "image",
          image: "ghcr.io/acme/api:1.0.0",
          sourceSubdir: null,
          repo: null,
          branch: null,
          imageRepository: null,
          replicas: 1,
          command: null,
          entrypoint: null,
          ports: [],
          env: {},
          publicEnabled: false,
          previewsEnabled: false,
          preDeploy: null,
          postDeploy: null,
          buildConfig: null,
          restartWindowMs: null,
          diskLimitMb: null,
          swapLimitMb: null,
          pidsLimit: null,
          ...over,
        },
      },
      databases: {},
      composes: {},
    };
  }

  const bare = manifest({
    project: "acme-api",
    services: { web: { source: "image", image: "ghcr.io/acme/api:1.0.0" } },
  });

  it("stages no env deletes when the manifest omits env (live-managed vars)", () => {
    const changes = diffManifest(
      bare,
      liveService({ env: { DATABASE_URL: "x", RESEND_API_KEY: "y" } }),
    );
    expect(changes).toEqual([{ kind: "no-op", resource: "service", name: "web" }]);
  });

  it("treats an empty declared env map ({}) as live-managed too", () => {
    const m = manifest({
      project: "acme-api",
      services: { web: { source: "image", image: "ghcr.io/acme/api:1.0.0", env: {} } },
    });
    const changes = diffManifest(m, liveService({ env: { LIVE_ADDED: "x" } }));
    expect(changes).toEqual([{ kind: "no-op", resource: "service", name: "web" }]);
  });

  it("skips live-managed scalar fields the manifest omits", () => {
    const changes = diffManifest(
      bare,
      liveService({
        replicas: 3,
        command: ["bun", "start"],
        entrypoint: ["/entry.sh"],
        ports: [{ containerPort: 3000, protocol: "tcp", appProtocol: "http", isPrimary: true }],
        preDeploy: ["bun run migrate"],
        postDeploy: ["bun run seed"],
        restartWindowMs: 60_000,
        diskLimitMb: 1024,
        swapLimitMb: 512,
        pidsLimit: 100,
        sourceSubdir: "apps/web",
      }),
    );
    expect(changes).toEqual([{ kind: "no-op", resource: "service", name: "web" }]);
  });

  it("still diffs fields the manifest declares", () => {
    const m = manifest({
      project: "acme-api",
      services: { web: { source: "image", image: "ghcr.io/acme/api:1.0.0", replicas: 1 } },
    });
    const changes = diffManifest(m, liveService({ replicas: 3 }));
    expect(changes).toEqual([
      {
        kind: "update",
        resource: "service",
        name: "web",
        details: { fields: { replicas: { from: 3, to: 1 } } },
      },
    ]);
  });

  it("resolves declared env refs before comparing (no phantom update)", () => {
    const m = manifest({
      project: "acme-api",
      services: {
        web: {
          source: "image",
          image: "ghcr.io/acme/api:1.0.0",
          env: { DATABASE_URL: "${database:primary.url}" },
        },
      },
      databases: { primary: { engine: "postgres" } },
    });
    const current = liveService({ env: { DATABASE_URL: "postgres://real-url" } });
    current.databases = {
      primary: {
        name: "primary",
        engine: "postgres",
        publicEnabled: false,
        previewBranching: false,
        extraEnv: {},
      },
    };
    // Apply stores the RESOLVED value — the resolver makes the diff compare
    // what apply would write, so a satisfied ref is a no-op…
    const resolveEnvValue = (raw: string) =>
      raw === "${database:primary.url}" ? "postgres://real-url" : null;
    expect(diffManifest(m, current, { resolveEnvValue })).toEqual([
      { kind: "no-op", resource: "service", name: "web" },
      { kind: "no-op", resource: "database", name: "primary" },
    ]);
    // …and a ref whose target changed stages a real update.
    const changed = (raw: string) =>
      raw === "${database:primary.url}" ? "postgres://other-url" : null;
    expect(diffManifest(m, current, { resolveEnvValue: changed })).toContainEqual({
      kind: "update",
      resource: "env",
      name: "web.DATABASE_URL",
      details: {
        from: "postgres://real-url",
        to: "${database:primary.url}",
        parent: "service",
        key: "DATABASE_URL",
        owner: "web",
      },
    });
  });
});
