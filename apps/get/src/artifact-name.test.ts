import { describe, expect, test } from "bun:test";

import { ARTIFACT_NAMES, isArtifactName } from "./artifact-name";

describe("isArtifactName", () => {
  test("accepts exactly the authored artifact names", () => {
    for (const name of ARTIFACT_NAMES) expect(isArtifactName(name)).toBeTrue();
  });

  test("rejects inherited object names and lookalikes", () => {
    for (const name of ["constructor", "toString", "__proto__", "install", "INSTALL.SH"]) {
      expect(isArtifactName(name)).toBeFalse();
    }
  });
});
