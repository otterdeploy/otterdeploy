/**
 * od-5j8.12 — hostile-path coverage: `mapEnvVar` (the mapper `listEnv` /
 * `setEnv` / `bulkSetEnv` all funnel rows through before they reach an RPC
 * response) must mask a sealed row's value regardless of what's actually
 * stored in it — ciphertext, or a bug that left plaintext behind. Pure
 * function, no mocks needed.
 */
import { describe, expect, test } from "vite-plus/test";

import { mapEnvVar } from "../views";

describe("mapEnvVar masks sealed rows", () => {
  test("sealed row: value is always masked to \"\", regardless of what's stored", () => {
    const view = mapEnvVar({
      id: "sev_1",
      serviceResourceId: "resource_1",
      key: "API_TOKEN",
      value: "v2:env-vars:1:nonce:ciphertext",
      sealed: true,
    });
    expect(view.value).toBe("");
    expect(view.sealed).toBe(true);
  });

  test("hostile case: even if a bug left PLAINTEXT in a sealed row, mapEnvVar still masks it", () => {
    const view = mapEnvVar({
      id: "sev_1",
      serviceResourceId: "resource_1",
      key: "API_TOKEN",
      value: "oops-this-should-never-happen-plaintext",
      sealed: true,
    });
    expect(view.value).toBe("");
  });

  test("non-sealed row: value passes through untouched", () => {
    const view = mapEnvVar({
      id: "sev_2",
      serviceResourceId: "resource_1",
      key: "PLAIN",
      value: "visible-value",
      sealed: false,
    });
    expect(view.value).toBe("visible-value");
    expect(view.sealed).toBe(false);
  });

  test("sealed defaults to false when the caller doesn't pass it (legacy row shape)", () => {
    const view = mapEnvVar({
      id: "sev_3",
      serviceResourceId: "resource_1",
      key: "PLAIN",
      value: "visible-value",
    });
    expect(view.sealed).toBe(false);
    expect(view.value).toBe("visible-value");
  });
});
