import { describe, expect, it } from "vite-plus/test";

import { suggestions } from "./suggest";

const COMMANDS = [
  "login",
  "logout",
  "whoami",
  "init",
  "up",
  "deploy",
  "redeploy",
  "sync",
  "status",
  "logs",
  "domains",
  "environments",
];

describe("suggestions", () => {
  it("catches a transposition, which is the most common CLI typo", () => {
    expect(suggestions("dpeloy", COMMANDS)).toContain("deploy");
    expect(suggestions("staus", COMMANDS)).toContain("status");
  });

  it("offers a prefix match however far the edit distance", () => {
    // `environments` is 4 edits from `environment`, past any sane threshold —
    // but a user typing a prefix clearly means the longer name.
    expect(suggestions("environment", COMMANDS)).toContain("environments");
  });

  it("ranks the closest candidate first", () => {
    expect(suggestions("deploi", COMMANDS)[0]).toBe("deploy");
  });

  it("does not flood short inputs with loose matches", () => {
    // "up" is 2 chars; a 1-edit threshold keeps this from matching half the set.
    expect(suggestions("up", COMMANDS).length).toBeLessThanOrEqual(3);
  });

  it("returns nothing for input that resembles no command", () => {
    expect(suggestions("zzzzzzzzz", COMMANDS)).toEqual([]);
  });

  it("respects the limit", () => {
    expect(suggestions("lo", COMMANDS, 2).length).toBeLessThanOrEqual(2);
  });
});
