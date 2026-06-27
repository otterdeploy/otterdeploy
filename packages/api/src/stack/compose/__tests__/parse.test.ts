import { describe, expect, it } from "vitest";

import { parseCompose } from "../parse";

function ok(yaml: string) {
  const r = parseCompose(yaml);
  if (r.isErr()) throw new Error(`expected ok, got: ${r.error.message}`);
  return r.value;
}

describe("parseCompose", () => {
  it("parses a realistic multi-service file", () => {
    const c = ok(`
services:
  app:
    image: ghcr.io/acme/app:latest
    ports: ["3000:3000"]
    depends_on: [postgres, redis]
    environment:
      DATABASE_URL: postgres://db
      DEBUG: "1"
    deploy:
      replicas: 2
      resources:
        limits: { cpus: "0.5", memory: 512M }
  postgres:
    image: postgres:16
    volumes: ["pgdata:/var/lib/postgresql/data"]
    environment:
      - POSTGRES_PASSWORD=secret
  redis:
    image: redis:7-alpine

volumes:
  pgdata:
`);
    expect(c.services.map((s) => s.name).sort()).toEqual(["app", "postgres", "redis"]);
    const app = c.services.find((s) => s.name === "app")!;
    expect(app.image).toBe("ghcr.io/acme/app:latest");
    expect(app.ports).toEqual([{ target: 3000, published: 3000, protocol: "tcp" }]);
    expect(app.dependsOn).toEqual(["postgres", "redis"]);
    expect(app.env).toEqual({ DATABASE_URL: "postgres://db", DEBUG: "1" });
    expect(app.replicas).toBe(2);
    expect(app.resources).toEqual({ cpus: "0.5", memoryMb: 512 });

    const pg = c.services.find((s) => s.name === "postgres")!;
    expect(pg.env).toEqual({ POSTGRES_PASSWORD: "secret" }); // array form
    expect(pg.volumes).toEqual([
      { type: "volume", source: "pgdata", target: "/var/lib/postgresql/data", readOnly: false },
    ]);
    expect(c.volumeNames).toEqual(["pgdata"]);
  });

  it("normalizes port spellings", () => {
    const c = ok(`
services:
  a:
    image: x
    ports:
      - "8080:80/udp"
      - "127.0.0.1:9090:90"
      - 3000
      - { target: 7000, published: 17000, protocol: tcp }
`);
    expect(c.services[0].ports).toEqual([
      { target: 80, published: 8080, protocol: "udp" },
      { target: 90, published: 9090, protocol: "tcp" },
      { target: 3000, protocol: "tcp" },
      { target: 7000, published: 17000, protocol: "tcp" },
    ]);
    expect(c.warnings.some((w) => w.includes("host IP"))).toBe(true);
  });

  it("classifies build services and shell-wraps string command", () => {
    const c = ok(`
services:
  web:
    build: ./web
    command: node server.js
  api:
    build:
      context: ./api
      dockerfile: Dockerfile.prod
      args: { NODE_ENV: production }
    image: registry/api:cached
`);
    const web = c.services.find((s) => s.name === "web")!;
    expect(web.image).toBeNull();
    expect(web.build).toEqual({ context: "./web" });
    expect(web.command).toEqual(["/bin/sh", "-c", "node server.js"]);
    const api = c.services.find((s) => s.name === "api")!;
    expect(api.build).toEqual({
      context: "./api",
      dockerfile: "Dockerfile.prod",
      args: { NODE_ENV: "production" },
    });
    expect(api.image).toBe("registry/api:cached");
  });

  it("drops host bind mounts with a warning", () => {
    const c = ok(`
services:
  a:
    image: x
    volumes:
      - "./src:/app"
      - "/etc/hosts:/etc/hosts:ro"
      - "named:/data"
`);
    expect(c.services[0].volumes).toEqual([
      { type: "volume", source: "named", target: "/data", readOnly: false },
    ]);
    expect(c.warnings.filter((w) => w.includes("bind mount")).length).toBe(2);
  });

  it("maps restart and healthcheck", () => {
    const c = ok(`
services:
  a:
    image: x
    restart: unless-stopped
    healthcheck:
      test: curl -f http://localhost/health
      interval: 10s
      retries: 5
  b:
    image: y
    deploy:
      restart_policy:
        condition: on-failure
`);
    const a = c.services.find((s) => s.name === "a")!;
    expect(a.restart).toBe("unless-stopped");
    expect(a.healthcheck).toEqual({
      test: ["CMD-SHELL", "curl -f http://localhost/health"],
      interval: "10s",
      retries: 5,
    });
    expect(c.services.find((s) => s.name === "b")!.restart).toBe("on-failure");
  });

  it("captures the top-level project name", () => {
    expect(ok("name: paperhouse\nservices:\n  a:\n    image: x").name).toBe("paperhouse");
    expect(ok("services:\n  a:\n    image: x").name).toBeNull();
  });

  it("reports a line for a YAML syntax error", () => {
    const r = parseCompose(`services:\n  app:\n    ports: ["80:80"\n`);
    if (r.isOk()) throw new Error("expected a parse error");
    expect(typeof r.error.line).toBe("number");
    expect(r.error.line).toBeGreaterThan(0);
  });

  it("rejects broken files", () => {
    expect(parseCompose("::: not yaml :::").isErr()).toBe(true);
    expect(parseCompose("name: nope").isErr()).toBe(true); // no services
    expect(parseCompose("services:\n  a:\n    command: x").isErr()).toBe(true); // no image/build
  });

  it("parses memory units to MB", () => {
    const c = ok(`
services:
  a:
    image: x
    deploy:
      resources:
        limits: { memory: 1g }
`);
    expect(c.services[0].resources.memoryMb).toBe(1024);
  });
});
