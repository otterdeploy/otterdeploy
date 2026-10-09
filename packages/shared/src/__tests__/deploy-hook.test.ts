import { describe, expect, test } from "bun:test";

import { hookFromShellLines, hookInvocations, hookShellLines } from "../deploy-hook";

// the manifest stores hooks in exec form, and the builder ran
// every element as its own `sh -c`, so `["bundle","exec","rails","db:prepare"]`
// ran `sh -c bundle` and exited 23.
describe("hookInvocations", () => {
  test("exec form runs as ONE container with that argv", () => {
    expect(hookInvocations(["bundle", "exec", "rails", "db:prepare"])).toEqual([
      ["bundle", "exec", "rails", "db:prepare"],
    ]);
  });

  test("the manifest's string shorthand runs its shell line once", () => {
    expect(hookInvocations(["sh", "-c", "bun run db:migrate && bun run db:seed"])).toEqual([
      ["sh", "-c", "bun run db:migrate && bun run db:seed"],
    ]);
  });

  test("a legacy list of shell lines still runs one sh -c per line", () => {
    expect(hookInvocations(["bun run db:migrate", "bun run db:seed", "  "])).toEqual([
      ["sh", "-c", "bun run db:migrate"],
      ["sh", "-c", "bun run db:seed"],
    ]);
  });

  test("an empty hook runs nothing", () => {
    expect(hookInvocations([])).toEqual([]);
  });
});

describe("hookShellLines / hookFromShellLines", () => {
  test("editor rows round-trip through the stored sh -c form", () => {
    const stored = hookFromShellLines(["bun run db:migrate", " ", "bun run db:seed"]);
    expect(stored).toEqual(["sh", "-c", "bun run db:migrate && bun run db:seed"]);
    expect(hookShellLines(stored ?? [])).toEqual(["bun run db:migrate", "bun run db:seed"]);
  });

  test("no rows store no hook", () => {
    expect(hookFromShellLines(["", "  "])).toBeNull();
  });

  test("an exec-form hook edits as one quoted line that runs the same argv", () => {
    expect(hookShellLines(["bundle", "exec", "rails", "db:prepare"])).toEqual([
      "bundle exec rails db:prepare",
    ]);
    expect(hookShellLines(["echo", "it's done"])).toEqual([`echo 'it'"'"'s done'`]);
  });

  test("legacy shell lines edit as their rows", () => {
    expect(hookShellLines(["bun run a", "bun run b"])).toEqual(["bun run a", "bun run b"]);
  });
});
