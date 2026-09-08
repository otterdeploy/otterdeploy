/**
 * od-mizn: `manifest.save` replaces the whole document, so an omitted resource
 * is a deletion.
 *
 * That is a defensible design for a declarative document and a dangerous one
 * at a call site, because the difference between "update one field" and "wipe
 * the project" is invisible: the read-modify-write pattern has to be inferred,
 * and only the `expectedVersion` check stood between a malformed payload and a
 * project with no services. The reporter's own words: it "will silently delete
 * resources omitted from the payload".
 *
 * These pin the computation the dry run reports, which is the part that has to
 * be right for the warning to be worth anything.
 */
import { describe, expect, it } from "vite-plus/test";

import { manifestSchema } from "../../../stack/manifest";
import { manifestRemovals } from "../manifest";

const parse = (input: Record<string, unknown>) =>
  manifestSchema.parse({ project: "acme", ...input });

const svc = { source: "image" as const, image: "acme:1" };
const db = { engine: "postgres" as const };

describe("manifestRemovals", () => {
  it("names what an omitted resource deletes", () => {
    const current = parse({ services: { api: svc, worker: svc } });
    const next = parse({ services: { api: svc } });
    expect(manifestRemovals(current, next)).toEqual([{ resource: "service", name: "worker" }]);
  });

  it("catches the empty-services payload that nearly wiped the project", () => {
    // The reporter's actual near-miss: `"services":{}` removes every service.
    const current = parse({ services: { api: svc, worker: svc }, databases: { pg: db } });
    const next = parse({ services: {}, databases: { pg: db } });
    expect(manifestRemovals(current, next)).toEqual([
      { resource: "service", name: "api" },
      { resource: "service", name: "worker" },
    ]);
  });

  it("covers databases and composes, not just services", () => {
    const current = parse({
      databases: { pg: db },
      composes: { stack: { source: "inline" as const, content: "services: {}" } },
    });
    const next = parse({});
    expect(manifestRemovals(current, next)).toEqual([
      { resource: "compose", name: "stack" },
      { resource: "database", name: "pg" },
    ]);
  });

  it("reports nothing for an ordinary edit", () => {
    // The common case has to be silent, or the warning becomes noise and the
    // one that matters gets clicked through.
    const current = parse({ services: { api: svc } });
    const next = parse({ services: { api: { ...svc, image: "acme:2" } } });
    expect(manifestRemovals(current, next)).toEqual([]);
  });

  it("reports nothing on a first save", () => {
    // No stored manifest means nothing can be removed by omission.
    expect(manifestRemovals(null, parse({ services: { api: svc } }))).toEqual([]);
  });

  it("is stably ordered", () => {
    // A list the operator reads twice must not reshuffle between reads.
    const current = parse({ services: { b: svc, a: svc }, databases: { z: db } });
    const next = parse({});
    expect(manifestRemovals(current, next)).toEqual([
      { resource: "database", name: "z" },
      { resource: "service", name: "a" },
      { resource: "service", name: "b" },
    ]);
  });
});
