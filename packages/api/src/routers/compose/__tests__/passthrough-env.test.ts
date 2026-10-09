/**
 * A bare `environment` key passes the same-named variable through, or stays
 * unset; it is never an empty string.
 *
 * Plausible CE lists its optional settings bare
 * (`- HTTP_PORT`, `- DATABASE_URL`), so every one reached the container as
 * `""` and Plausible bound to port "" instead of its default; n8n's Postgres
 * takes `- POSTGRES_PASSWORD` that way and initialised with no password even
 * though the stack's variables carried one.
 */
import { hasPrefix, type Id } from "@otterdeploy/shared/id";
import { describe, expect, it } from "vite-plus/test";

import type { StackReconcileContext } from "../reconcile";

import { parseCompose } from "../../../stack/compose";
import { toServiceFields } from "../reconcile-map";

function service(yaml: string, name: string) {
  const r = parseCompose(yaml);
  if (r.isErr()) throw new Error(r.error.message);
  const svc = r.value.services.find((s) => s.name === name);
  if (!svc) throw new Error(`service ${name} not found`);
  return svc;
}

function testId<P extends string>(value: string, prefix: P): Id<P> {
  if (!hasPrefix(value, prefix)) {
    throw new Error(`test id "${value}" does not carry prefix "${prefix}"`);
  }
  return value;
}

function context(projectVars: Record<string, string>): StackReconcileContext {
  return {
    projectId: testId("prj_1", "prj"),
    placementServerId: null,
    organizationId: testId("org_1", "org"),
    exposedSeeds: new Map(),
    stackResourceId: testId("res_1", "res"),
    projectSlug: "analytics",
    stackName: "n8n",
    projectVars,
    builtImages: {},
  };
}

function envMap(rows: Array<{ key: string; value: string }>): Record<string, string> {
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

const N8N_POSTGRES = `
services:
  postgres:
    image: postgres:16
    environment:
      - POSTGRES_USER
      - POSTGRES_PASSWORD
      - POSTGRES_DB
      - PGDATA=/var/lib/postgresql/data/pgdata
`;

const PLAUSIBLE = `
services:
  plausible:
    image: ghcr.io/plausible/community-edition:v3.2.1
    environment:
      BASE_URL: \${BASE_URL}
      HTTP_PORT:
      DATABASE_URL:
`;

describe("compose environment: bare keys", () => {
  it("parses a bare list key and a valueless map key as pass-through, not as an empty value", () => {
    const pg = service(N8N_POSTGRES, "postgres");
    expect(pg.env).toEqual({ PGDATA: "/var/lib/postgresql/data/pgdata" });
    expect(pg.passthroughEnv).toEqual(["POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB"]);

    const plausible = service(PLAUSIBLE, "plausible");
    expect(plausible.env).toEqual({ BASE_URL: "${BASE_URL}" });
    expect(plausible.passthroughEnv).toEqual(["HTTP_PORT", "DATABASE_URL"]);
  });

  it("passes the stack's same-named variable through to the container", () => {
    const { env } = toServiceFields(
      service(N8N_POSTGRES, "postgres"),
      context({ POSTGRES_USER: "n8nroot", POSTGRES_PASSWORD: "s3cret", POSTGRES_DB: "n8n" }),
      "postgres:16",
    );
    expect(envMap(env)).toEqual({
      PGDATA: "/var/lib/postgresql/data/pgdata",
      POSTGRES_USER: "n8nroot",
      POSTGRES_PASSWORD: "s3cret",
      POSTGRES_DB: "n8n",
    });
  });

  it("leaves a bare key with no variable unset, so the image's own default applies", () => {
    const { env } = toServiceFields(
      service(PLAUSIBLE, "plausible"),
      context({ BASE_URL: "https://plausible.example" }),
      "ghcr.io/plausible/community-edition:v3.2.1",
    );
    expect(envMap(env)).toEqual({ BASE_URL: "https://plausible.example" });
  });

  it("lets a later entry for the same key decide, as compose does", () => {
    const svc = service(
      `
services:
  app:
    image: nginx
    environment:
      - A
      - A=1
      - B=2
      - B
`,
      "app",
    );
    expect(svc.env).toEqual({ A: "1" });
    expect(svc.passthroughEnv).toEqual(["B"]);
  });

  it("keeps a bare label an empty value: only environment passes through", () => {
    const svc = service(
      `
services:
  app:
    image: nginx
    labels:
      - com.example.marker
`,
      "app",
    );
    expect(svc.labels).toEqual({ "com.example.marker": "" });
  });
});
