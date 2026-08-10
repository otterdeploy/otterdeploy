import { describe, expect, test } from "vite-plus/test";

import { isReadAction, isReadMethod } from "../index";

describe("isReadMethod (authoritative HTTP-method audit gate)", () => {
  test("GET is a read, any other declared method is a mutation", () => {
    expect(isReadMethod({ method: "GET" }, undefined)).toBe(true);
    expect(isReadMethod({ method: "get" }, undefined)).toBe(true);
    expect(isReadMethod({ method: "POST" }, undefined)).toBe(false);
    expect(isReadMethod({ method: "PUT" }, undefined)).toBe(false);
    expect(isReadMethod({ method: "DELETE" }, undefined)).toBe(false);
    expect(isReadMethod({ method: "PATCH" }, undefined)).toBe(false);
  });

  test("no method anywhere ⇒ null, caller falls back to the name heuristic", () => {
    expect(isReadMethod(undefined, undefined)).toBeNull();
    expect(isReadMethod({}, {})).toBeNull();
    expect(isReadMethod({ tag: "project" }, undefined)).toBeNull();
  });

  // Some contracts (sshKeys, apiKeys, certificates, notifications, webhooks)
  // declare their method via oRPC's own `.route({ method })` instead of this
  // repo's usual `.meta({ method })` convention. That lands on a different
  // field entirely. Missing this would silently go blind on every endpoint
  // in those five files.
  test("`.route({ method })` is read the same as `.meta({ method })`", () => {
    expect(isReadMethod(undefined, { method: "GET" })).toBe(true);
    expect(isReadMethod(undefined, { method: "POST" })).toBe(false);
    // route wins when (implausibly) both are present and disagree.
    expect(isReadMethod({ method: "POST" }, { method: "GET" })).toBe(true);
  });

  // od-1kc.2 regression: these four action names all read data and all
  // declare `method: "GET"` in their contract, but none of their last path
  // segments matched the old name-only READ_VERB allowlist ("query",
  // "version", "platform", "decisions" weren't in it). Every poll of them
  // landed an audit row. The method gate must catch all of them even though
  // the name heuristic still doesn't.
  test("od-1kc.2 regression: GET-only endpoints whose verb the name heuristic misses", () => {
    for (const action of [
      "edgeLogs.query",
      "system.version",
      "metrics.platform",
      "firewall.decisions",
    ]) {
      expect(isReadAction(action)).toBe(false); // the old heuristic alone gets this wrong
      expect(isReadMethod({ method: "GET" }, undefined)).toBe(true); // the method gate gets it right
    }
  });
});

describe("isReadAction (name-heuristic fallback)", () => {
  test("still matches the verbs it always has, for procedures with no method meta", () => {
    expect(isReadAction("project.resource.list")).toBe(true);
    expect(isReadAction("project.resource.get")).toBe(true);
    expect(isReadAction("notifications.inbox.list")).toBe(true);
  });

  test("mutating verbs are not reads", () => {
    expect(isReadAction("project.resource.delete")).toBe(false);
    expect(isReadAction("project.postgres.create")).toBe(false);
    expect(isReadAction("server.restart")).toBe(false);
  });
});
