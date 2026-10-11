/**
 * One name cannot be used by two of a manifest's services, databases and
 * compose stacks.
 *
 * All three become rows in one `resource` table under one unique index on
 * (project, environment, name). Three separate maps in the document hide that:
 * `services.api` and `databases.api` read as two different things and used to
 * parse fine. Apply then created the database first and failed the service on
 * a raw unique-constraint error, leaving the project half-applied, since apply
 * is not transactional across phases.
 *
 * Checked per environment too: an environment block can add a name, or free
 * one with `null`, so its effective set is not the base set.
 */
import { describe, expect, it } from "vite-plus/test";

import { manifestSchema } from "../schema";

const imageService = { source: "image", image: "nginx" } as const;
const postgres = { engine: "postgres" } as const;
const inlineStack = { source: "inline", content: "services: {}" } as const;

function parse(document: Record<string, unknown>) {
  return manifestSchema.safeParse({ project: "acme-api", ...document });
}

function issues(document: Record<string, unknown>) {
  const result = parse(document);
  return result.success ? [] : result.error.issues;
}

describe("resource names share one namespace", () => {
  it("rejects a name used by both a service and a database", () => {
    const found = issues({ services: { api: imageService }, databases: { api: postgres } });

    expect(found.map((issue) => issue.message).join("\n")).toContain(
      '"api" is declared as a service and a database',
    );
  });

  it("rejects a name used by both a service and a compose stack", () => {
    const found = issues({ services: { api: imageService }, composes: { api: inlineStack } });

    expect(found.map((issue) => issue.message).join("\n")).toContain(
      '"api" is declared as a service and a compose stack',
    );
  });

  it("rejects a name used by both a database and a compose stack", () => {
    const found = issues({ databases: { api: postgres }, composes: { api: inlineStack } });

    expect(found.map((issue) => issue.message).join("\n")).toContain(
      '"api" is declared as a database and a compose stack',
    );
  });

  it("names the environment when an override introduces the collision", () => {
    // The base is clean: `api` is only a database. Staging adds a service of
    // the same name, so staging, and only staging, cannot be applied.
    const found = issues({
      databases: { api: postgres },
      environments: { staging: { services: { api: imageService } } },
    });

    const issue = found.find((candidate) => candidate.message.includes('"api"'));
    expect(issue?.path).toEqual(["environments", "staging"]);
  });

  it("reports a base collision once, not again for every environment", () => {
    const found = issues({
      services: { api: imageService },
      databases: { api: postgres },
      environments: { staging: {}, production: {} },
    });

    expect(found.filter((issue) => issue.message.includes('"api"'))).toHaveLength(1);
  });

  it("allows reusing a name the environment freed with null", () => {
    // `null` removes the database from staging, so the service collides with
    // nothing there.
    const result = parse({
      databases: { api: postgres },
      environments: { staging: { databases: { api: null }, services: { api: imageService } } },
    });

    expect(result.success).toBe(true);
  });

  it("leaves distinct names alone", () => {
    const result = parse({
      services: { web: imageService },
      databases: { db: postgres },
      composes: { stack: inlineStack },
    });

    expect(result.success).toBe(true);
  });
});
