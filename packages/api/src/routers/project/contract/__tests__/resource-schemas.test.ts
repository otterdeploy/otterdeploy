/**
 * The `buildConfig` field on the service resource contract.
 *
 * It used to be `z.unknown()`, which typed correctly (anything passes) but
 * pushed the narrowing onto every consumer — the web app carried four prop
 * shapes and three hand-written casts just to read `builder`. It is now the
 * real `buildSchema` union, so the discriminator does that work.
 *
 * The tests below pin the part of that swap which isn't free: this is an
 * OUTPUT schema on the whole-project resource list, so a stored row that
 * doesn't match the union must degrade to null rather than fail the response
 * and blank the project graph.
 */

import { describe, expect, test } from "vite-plus/test";

import { serviceResourceSchema } from "../resource-schemas";

const buildConfig = serviceResourceSchema.shape.buildConfig;

describe("serviceResourceSchema.buildConfig", () => {
  test("passes a well-formed config through with its variant fields intact", () => {
    const parsed = buildConfig.parse({
      builder: "dockerfile",
      dockerfilePath: "./apps/web/Dockerfile",
      buildArgs: { NODE_ENV: "production" },
    });
    expect(parsed).toEqual({
      builder: "dockerfile",
      dockerfilePath: "./apps/web/Dockerfile",
      buildArgs: { NODE_ENV: "production" },
    });
  });

  test("keeps null and undefined — a service with no build config is normal", () => {
    expect(buildConfig.parse(null)).toBeNull();
    expect(buildConfig.parse(undefined)).toBeUndefined();
  });

  test("degrades an unrecognised builder to null instead of throwing", () => {
    // A row written before a builder was renamed/removed. Under `z.unknown()`
    // this reached the client and the hand-narrowing rendered no build card;
    // the union must reach the same outcome, not reject the whole resource.
    expect(buildConfig.parse({ builder: "nixpacks", startCommand: "npm start" })).toBeNull();
  });

  test("degrades a malformed variant to null instead of throwing", () => {
    // Right discriminator, wrong payload type for the variant.
    expect(buildConfig.parse({ builder: "railpack", buildCommand: 42 })).toBeNull();
  });
});
