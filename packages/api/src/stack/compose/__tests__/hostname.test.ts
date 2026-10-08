/**
 * a compose key that is not a DNS label (`plausible_db`) was
 * stored as `plausible-db`, and the key itself resolved to nothing, so an app
 * that dials it from its own defaults crash-looped on nxdomain.
 */
import { describe, expect, test } from "vite-plus/test";

import type { SwarmServiceSpec } from "../../../swarm";

import { serviceAliases } from "../../../runtime/docker-driver-helpers";
import { buildServiceSpec } from "../../../swarm/internals";
import { createComposeHostLabel, resolveComposeKeyAlias } from "../hostname";

describe("createComposeHostLabel", () => {
  test("lowercases and folds anything outside [a-z0-9] into one hyphen", () => {
    expect(createComposeHostLabel("plausible_events_db")).toBe("plausible-events-db");
    expect(createComposeHostLabel("Web.App")).toBe("web-app");
    expect(createComposeHostLabel("_db_")).toBe("db");
  });
});

describe("resolveComposeKeyAlias", () => {
  test("an underscore key is kept as an alias beside its label", () => {
    expect(resolveComposeKeyAlias("plausible_db", "plausible-db")).toBe("plausible_db");
    expect(resolveComposeKeyAlias("plausible_events_db", "plausible-events-db")).toBe(
      "plausible_events_db",
    );
  });

  test("a key that already is the hostname needs nothing, case included", () => {
    expect(resolveComposeKeyAlias("db", "db")).toBeNull();
    expect(resolveComposeKeyAlias("DB", "db")).toBeNull();
  });

  test("a child renamed for a collision does not claim the key another stack answers to", () => {
    expect(resolveComposeKeyAlias("plausible_db", "plausible-plausible-db")).toBeNull();
  });

  test("a standalone service, or a key that is no single DNS label, gets no alias", () => {
    expect(resolveComposeKeyAlias(null, "api")).toBeNull();
    expect(resolveComposeKeyAlias("web.app", "web-app")).toBeNull();
  });
});

describe("the alias reaches both runtimes", () => {
  const spec: SwarmServiceSpec = {
    resourceId: "res_1",
    resourceName: "plausible-plausible-db",
    projectSlug: "analytics",
    serviceName: "od-analytics-plausible-plausible-db",
    internalHostname: "plausible-db",
    composeKeyAlias: "plausible_db",
    image: "postgres:16-alpine",
    env: {},
    replicas: 1,
    restart: { condition: "any", delayMs: 5000 },
    ports: [],
    mounts: [],
    forceUpdateCounter: 0,
  };

  test("swarm: the project network carries the compose key", () => {
    const built = buildServiceSpec(spec, "otterdeploy-analytics");
    expect(built.TaskTemplate.Networks[0]?.Aliases).toContain("plausible_db");
  });

  test("plain docker: the container's aliases carry the compose key", () => {
    expect(serviceAliases(spec)).toContain("plausible_db");
    expect(serviceAliases({ ...spec, composeKeyAlias: null })).not.toContain("plausible_db");
  });
});
