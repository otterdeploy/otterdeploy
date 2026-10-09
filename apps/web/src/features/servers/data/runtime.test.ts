/**
 * The Servers page subtitle names the runtime in use, checked
 * against the REAL English bundle so a renamed key fails here rather than
 * rendering its own name.
 */
import { createInstance } from "i18next";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { i18nOptions } from "../../../../../../packages/i18n/src/config";
import { deployRuntime, serversDescriptionKey } from "./runtime";

const i18n = createInstance();

beforeAll(async () => {
  await i18n.init({ ...i18nOptions, lng: "en", initAsync: false });
});

function subtitle(view: { swarm: boolean } | null, count: number): string {
  return i18n.t(serversDescriptionKey(deployRuntime(view)), { count });
}

describe("Servers subtitle", () => {
  it("on the plain-Docker runtime it says so, with no swarm or stack wording", () => {
    const text = subtitle({ swarm: false }, 2);
    expect(text).toBe("2 servers · services run as plain Docker containers on the control plane");
    expect(text.toLowerCase()).not.toContain("swarm");
    expect(text).not.toContain("Stack");
  });

  it("on the Swarm runtime it keeps the swarm wording", () => {
    expect(subtitle({ swarm: true }, 1)).toContain("1 node in this swarm");
  });

  it("before the runtime is known it only counts", () => {
    expect(subtitle(null, 2)).toBe("2 servers");
  });
});
