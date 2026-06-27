import { describe, expect, test } from "bun:test";

import {
  authorizeKeyScope,
  authorizeRoleScope,
  isReadAction,
  isReadAllowed,
  requireProjectScope,
} from "../api-key-scope";

describe("authorizeKeyScope (per-key permission map)", () => {
  test("null key permissions = full-access key ⇒ allowed", () => {
    expect(authorizeKeyScope(null, { service: ["deploy"] })).toBe(true);
    expect(authorizeKeyScope(null, { server: ["delete"] })).toBe(true);
  });

  test("key covering the required action ⇒ allowed", () => {
    expect(authorizeKeyScope({ service: ["read", "deploy"] }, { service: ["deploy"] })).toBe(true);
  });

  test("resource absent in key ⇒ denied", () => {
    expect(authorizeKeyScope({ project: ["read"] }, { service: ["deploy"] })).toBe(false);
  });

  test("action missing from the covered resource ⇒ denied", () => {
    expect(authorizeKeyScope({ service: ["read"] }, { service: ["deploy"] })).toBe(false);
  });

  test("empty required actions are a no-op (allowed)", () => {
    expect(authorizeKeyScope({ service: ["read"] }, { service: [] })).toBe(true);
  });
});

describe("authorizeRoleScope (DECISION A — member-role cap)", () => {
  test("members lack database:write ⇒ denied even if key would list it", () => {
    expect(authorizeRoleScope({ database: ["write"] })).toBe(false);
  });

  test("members may service:deploy ⇒ allowed", () => {
    expect(authorizeRoleScope({ service: ["deploy"] })).toBe(true);
  });

  test("combined gate: key covers database:write but role cap still denies", () => {
    const keyAllows = authorizeKeyScope(
      { database: ["write"] },
      {
        database: ["write"],
      },
    );
    expect(keyAllows).toBe(true);
    expect(keyAllows && authorizeRoleScope({ database: ["write"] })).toBe(false);
  });
});

describe("isReadAction / isReadAllowed (read-only preset)", () => {
  test("classifies read vs write oRPC paths", () => {
    expect(isReadAction("service.list")).toBe(true);
    expect(isReadAction("edgeLogs.query")).toBe(false);
    expect(isReadAction("service.getStatus")).toBe(true);
    expect(isReadAction("service.deploy")).toBe(false);
  });

  test("read-only key blocks a write action", () => {
    expect(isReadAllowed("read", "service.deploy")).toBe(false);
  });

  test("read-only key allows a read action", () => {
    expect(isReadAllowed("read", "service.list")).toBe(true);
  });

  test("write / undefined preset imposes no restriction", () => {
    expect(isReadAllowed("write", "service.deploy")).toBe(true);
    expect(isReadAllowed(undefined, "service.deploy")).toBe(true);
  });
});

describe("requireProjectScope (project scoping)", () => {
  test("session actor (null ctx) ⇒ no-op, always allowed", () => {
    expect(requireProjectScope(null, "project_A")).toBe(true);
  });

  test("scope 'all' ⇒ allowed for any project", () => {
    expect(requireProjectScope({ projectScope: "all" }, "project_anything")).toBe(true);
  });

  test("absent projectScope ⇒ unrestricted", () => {
    expect(requireProjectScope({}, "project_anything")).toBe(true);
  });

  test("scope 'selected' ⇒ allowed for a listed project, denied otherwise", () => {
    const ctx = { projectScope: "selected" as const, projectIds: ["project_A"] };
    expect(requireProjectScope(ctx, "project_A")).toBe(true);
    expect(requireProjectScope(ctx, "project_B")).toBe(false);
  });

  test("scope 'selected' with no projectIds ⇒ denied", () => {
    expect(requireProjectScope({ projectScope: "selected" }, "project_A")).toBe(false);
  });
});
