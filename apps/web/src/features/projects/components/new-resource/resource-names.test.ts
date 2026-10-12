/**
 * The wizard's name defaults and inline check against the names
 * a project already has (services and databases, applied or staged).
 */
import { describe, expect, it } from "vite-plus/test";

import {
  bumpedFrom,
  firstFreeName,
  nameTakenError,
  RESOURCE_NAME_MAX,
  takenResourceNames,
} from "./resource-names";

describe("takenResourceNames", () => {
  it("reads services and databases from the staged manifest, as one name space", () => {
    const taken = takenResourceNames({
      services: { "it-tools": {} },
      databases: { postgres: {} },
    });
    expect([...taken].toSorted()).toEqual(["it-tools", "postgres"]);
    expect(takenResourceNames(null).size).toBe(0);
  });
});

describe("firstFreeName", () => {
  it("keeps a free name and suffixes a taken one", () => {
    expect(firstFreeName("web", new Set())).toBe("web");
    expect(firstFreeName("it-tools", new Set(["it-tools"]))).toBe("it-tools-2");
    expect(firstFreeName("it-tools", new Set(["it-tools", "it-tools-2"]))).toBe("it-tools-3");
  });

  it("stays within the field's length cap", () => {
    const long = "a".repeat(RESOURCE_NAME_MAX);
    const free = firstFreeName(long, new Set([long]), RESOURCE_NAME_MAX);
    expect(free).toHaveLength(RESOURCE_NAME_MAX);
    expect(free.endsWith("-2")).toBe(true);
  });
});

describe("nameTakenError", () => {
  const taken = new Set(["it-tools"]);

  it("refuses a taken name inline, naming the free one", () => {
    expect(nameTakenError("it-tools", taken, "service")).toBe(
      "A service named it-tools already exists in this project. Try it-tools-2.",
    );
    expect(nameTakenError("it-tools-2", taken, "service")).toBeUndefined();
  });
});

describe("bumpedFrom", () => {
  const taken = new Set(["it-tools"]);

  it("explains a default the wizard moved off a taken name", () => {
    expect(bumpedFrom("it-tools-2", taken, false)).toBe("it-tools");
  });

  it("says nothing for a name the operator typed, or one that was free", () => {
    expect(bumpedFrom("it-tools-2", taken, true)).toBeNull();
    expect(bumpedFrom("web-2", taken, false)).toBeNull();
  });
});
