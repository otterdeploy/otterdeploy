/**
 * What deploys a git-built service follows its binding: only an
 * installation-bound repo has the provider's push webhook. A repo bound by
 * public URL has no installation and deploys on a Deploy click, which the
 * Source card used to misstate as "pushing to its branch deploys it".
 */
import { describe, expect, test } from "vite-plus/test";

import { deployTriggerFromRepo } from "../views";

describe("deployTriggerFromRepo", () => {
  test("an installation-bound repo deploys on push", () => {
    expect(deployTriggerFromRepo({ installationId: "gti_abc" })).toBe("push");
  });

  test("a public-URL repo has no webhook and deploys manually", () => {
    expect(deployTriggerFromRepo({ installationId: null })).toBe("manual");
  });
});
