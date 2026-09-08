/**
 * od-3kvm: a shell line is accepted where exec form is meant.
 *
 * `preDeploy: "bun run db:migrate"` used to fail with
 * `expected array, received string` and no hint that exec form was wanted, so
 * the operator had to guess `["sh", "-c", …]` from the type error alone.
 *
 * The important half of this is the NEGATIVE case at the bottom: the same
 * shorthand is deliberately NOT offered for `startCommand`/`entrypoint`,
 * because wrapping a long-running process in `sh -c` makes the shell pid 1 and
 * it does not forward SIGTERM. If someone ever "fixes" that asymmetry for
 * consistency, this test is what should stop them.
 */
import { describe, expect, it } from "vite-plus/test";

import { manifestSchema } from "../schema";

function parseService(service: Record<string, unknown>) {
  return manifestSchema.parse({
    project: "acme",
    services: { api: { source: "image", image: "acme:1", ...service } },
  }).services.api;
}

describe("shell shorthand for lifecycle hooks", () => {
  it("wraps a plain string into exec form", () => {
    expect(parseService({ preDeploy: "bun run db:migrate && bun run db:seed" }).preDeploy).toEqual([
      "sh",
      "-c",
      "bun run db:migrate && bun run db:seed",
    ]);
  });

  it("leaves exec form untouched", () => {
    const exec = ["sh", "-c", "already wrapped"];
    expect(parseService({ preDeploy: exec }).preDeploy).toEqual(exec);
  });

  it("applies to postDeploy too", () => {
    expect(parseService({ postDeploy: "curl -fsS localhost:3000/health" }).postDeploy).toEqual([
      "sh",
      "-c",
      "curl -fsS localhost:3000/health",
    ]);
  });

  it("keeps null and undefined meaning what they meant", () => {
    expect(parseService({ preDeploy: null }).preDeploy).toBeNull();
    expect(parseService({}).preDeploy).toBeUndefined();
  });

  it("normalizes at parse, so nothing downstream sees the shorthand", () => {
    // The whole point of transforming here rather than at each consumer: diff,
    // apply and the runtime spec only ever handle one shape.
    const viaString = parseService({ preDeploy: "a && b" }).preDeploy;
    const viaArray = parseService({ preDeploy: ["sh", "-c", "a && b"] }).preDeploy;
    expect(viaString).toEqual(viaArray);
  });

  it("does NOT offer the shorthand for the long-running process", () => {
    // `sh -c` as pid 1 does not forward SIGTERM, so the app would never get
    // its shutdown signal and would die on the stop timeout instead. A silent,
    // delayed failure is not worth the convenience: exec form stays required.
    expect(() => parseService({ startCommand: "bun run start" })).toThrow();
    expect(() => parseService({ entrypoint: "./docker-entrypoint.sh" })).toThrow();
  });
});
