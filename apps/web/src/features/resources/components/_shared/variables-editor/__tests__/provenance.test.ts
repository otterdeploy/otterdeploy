/**
 * od-3hsu.1: provenance chips, scoped to what is TRUE today.
 *
 * od-1w02 means nothing is inherited: the project bag is reachable only
 * through an explicit `${{project.KEY}}` token and no stack bag exists. So
 * these pin what a value READS, never "where it was inherited from" — the
 * claim the data cannot support.
 */
import { describe, expect, it } from "vite-plus/test";

import { provenanceLabel, provenanceOf } from "../provenance";

const labels = (value: string) =>
  provenanceOf(value)
    .map(provenanceLabel)
    .filter((l): l is string => l !== null);

describe("provenanceOf", () => {
  it("a literal value is the service's own, and says nothing", () => {
    expect(provenanceOf("plain")).toEqual([{ kind: "own" }]);
    expect(labels("plain")).toEqual([]);
  });

  it("names the shared bags", () => {
    expect(labels("${{project.DB_NAME}}")).toEqual(["project"]);
    expect(labels("${{environment.TIER}}")).toEqual(["environment"]);
    expect(labels("${{vault.aws.prod/key}}")).toEqual(["vault"]);
  });

  it("names the resource a value reads", () => {
    expect(labels("postgres://${{postgres.HOST}}:5432/x")).toEqual(["postgres"]);
  });

  it("names the SIBLING for a stack-scoped ref, not 'stack'", () => {
    // `${{stack.db.HOST}}` addresses the sibling `db`; a chip reading "stack"
    // would name the scope and hide the answer.
    expect(labels("${{stack.db.HOST}}")).toEqual(["db"]);
  });

  it("lists every distinct source, because hiding one hides the surprise", () => {
    expect(labels("postgres://${{db.HOST}}/${{project.DB_NAME}}")).toEqual(["db", "project"]);
  });

  it("does not repeat a source read twice", () => {
    expect(labels("${{db.HOST}}:${{db.PORT}}")).toEqual(["db"]);
  });

  it("treats a half-typed reference as the service's own", () => {
    // Mid-edit the value is `${{db.` and parses to nothing; a chip that
    // flickered per keystroke would be worse than none.
    expect(provenanceOf("${{db.")).toEqual([{ kind: "own" }]);
  });

  it("tolerates whitespace inside the token", () => {
    expect(labels("${{ project.KEY }}")).toEqual(["project"]);
  });
});
