/**
 * `extends` resolution (see ../extends.ts).
 *
 * The motivating case is an upstream stack that declares almost nothing in the
 * file you point at: PostHog's `docker-compose.hobby.yml` is 33 services of
 * `extends: { file: docker-compose.base.yml, service: X }` plus overrides, and
 * without resolution it fails the parser's first structural check. So these
 * tests are about the MERGE being right, not merely about the file parsing —
 * a resolution that silently drops the base's image, or inherits a
 * `depends_on` pointing at a service the root file never declares, parses
 * clean and deploys wrong.
 */
import { describe, expect, it } from "vite-plus/test";

import { parseCompose } from "../parse";

function ok(yaml: string, files?: Record<string, string>) {
  const r = parseCompose(yaml, files ? { files } : {});
  if (r.isErr()) throw new Error(`expected ok, got: ${r.error.message}`);
  return r.value;
}

function err(yaml: string, files?: Record<string, string>): string {
  const r = parseCompose(yaml, files ? { files } : {});
  if (r.isOk()) throw new Error("expected an error");
  return r.error.message;
}

function service(yaml: string, name: string, files?: Record<string, string>) {
  const found = ok(yaml, files).services.find((s) => s.name === name);
  if (!found) throw new Error(`no service "${name}"`);
  return found;
}

describe("extends within one file", () => {
  const base = `
services:
  base:
    image: acme/app:1.2.3
    environment:
      LOG_LEVEL: info
      REGION: eu
    ports: ["3000"]
    restart: always
  web:
    extends: base
    environment:
      LOG_LEVEL: debug
    ports: ["4000"]
`;

  it("inherits the base's image", () => {
    expect(service(base, "web").image).toBe("acme/app:1.2.3");
  });

  it("merges environment key-by-key, local winning", () => {
    expect(service(base, "web").env).toEqual({ LOG_LEVEL: "debug", REGION: "eu" });
  });

  it("concatenates multi-value options rather than replacing them", () => {
    expect(service(base, "web").ports.map((p) => p.target)).toEqual([3000, 4000]);
  });

  it("carries scalar options the extending service does not restate", () => {
    expect(service(base, "web").restart).toBe("always");
  });

  it("leaves the base itself untouched", () => {
    expect(service(base, "base").env).toEqual({ LOG_LEVEL: "info", REGION: "eu" });
  });

  it("accepts the long form with no `file`", () => {
    const yaml = base.replace("extends: base", "extends:\n      service: base");
    expect(service(yaml, "web").image).toBe("acme/app:1.2.3");
  });
});

describe("extends across files", () => {
  const root = `
services:
  db:
    extends:
      file: base/common.yml
      service: db
    volumes: ["pgdata:/var/lib/postgresql/data"]
volumes:
  pgdata:
`;
  const common = `
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: secret
    volumes: ["/tmp/scratch"]
`;

  it("resolves a base out of a sibling file", () => {
    const db = service(root, "db", { "base/common.yml": common });
    expect(db.image).toBe("postgres:16-alpine");
    expect(db.env).toEqual({ POSTGRES_PASSWORD: "secret" });
  });

  it("merges mounts, keeping both distinct targets", () => {
    const db = service(root, "db", { "base/common.yml": common });
    expect(db.volumes.map((v) => v.target).sort()).toEqual([
      "/tmp/scratch",
      "/var/lib/postgresql/data",
    ]);
  });

  it("names the file it wanted when nothing supplies it", () => {
    expect(err(root)).toBe(
      'Service "db" extends the file "base/common.yml", which was not provided alongside this compose file',
    );
  });

  it("resolves a nested base relative to the file that names it", () => {
    // `base/common.yml` extends `shared.yml`, which sits in `base/`, NOT at the
    // root. Resolving relative to the ROOT file instead would look up
    // "shared.yml" and miss.
    const nested = `
services:
  db:
    extends:
      file: shared.yml
      service: db
    environment:
      POSTGRES_PASSWORD: secret
`;
    const shared = `
services:
  db:
    image: postgres:17-alpine
`;
    const db = service(root, "db", {
      "base/common.yml": nested,
      "base/shared.yml": shared,
    });
    expect(db.image).toBe("postgres:17-alpine");
    expect(db.env).toEqual({ POSTGRES_PASSWORD: "secret" });
  });
});

describe("what extends must NOT carry across", () => {
  // The spec's rule, and the reason for it: a base's `depends_on` names
  // services in the BASE's file. Inheriting it would make the stack depend on
  // a service it never declares, and `parseCompose`'s own "only depends_on
  // services that exist" consumers would then be reading an invented edge.
  const root = `
services:
  web:
    extends:
      file: base.yml
      service: web
    image: acme/web:1
    depends_on: [cache]
  cache:
    image: redis:7-alpine
`;
  const base = `
services:
  web:
    image: acme/web:0
    depends_on: [postgres, elasticsearch]
`;

  it("does not inherit depends_on", () => {
    expect(service(root, "web", { "base.yml": base }).dependsOn).toEqual(["cache"]);
  });
});

describe("mount overrides", () => {
  it("replaces a base mount that targets the same path", () => {
    const root = `
services:
  db:
    extends:
      file: base.yml
      service: db
    volumes: ["fresh:/var/lib/postgresql/data"]
volumes:
  fresh:
`;
    const base = `
services:
  db:
    image: postgres:16
    volumes: ["stale:/var/lib/postgresql/data"]
`;
    const db = service(root, "db", { "base.yml": base });
    // One mount, not two racing for the same path.
    expect(db.volumes).toHaveLength(1);
    expect(db.volumes[0]?.source).toBe("fresh");
  });
});

describe("resolution failures are diagnosable", () => {
  it("rejects a cycle instead of overflowing the stack", () => {
    const yaml = `
services:
  a:
    extends: b
  b:
    extends: a
`;
    expect(err(yaml)).toMatch(/extends itself, directly or through another service/);
  });

  it("names a base the file does not define", () => {
    const yaml = `
services:
  web:
    extends: nope
    image: acme/web:1
`;
    expect(err(yaml)).toBe('Service "web" extends "nope", which this file does not define');
  });

  it("reports a sibling file that is not valid YAML", () => {
    const yaml = `
services:
  web:
    extends:
      file: base.yml
      service: web
`;
    expect(err(yaml, { "base.yml": "services:\n  web:\n   - [unclosed" })).toMatch(
      /extends "base.yml", which is not valid YAML/,
    );
  });
});

describe("files that extend nothing", () => {
  it("are returned unchanged", () => {
    const c = ok(`
services:
  web:
    image: nginx:alpine
    ports: ["80"]
`);
    expect(c.services).toHaveLength(1);
    expect(c.warnings).toEqual([]);
  });
});
