/**
 * An API key must be usable for real automation.
 *
 * Without an explicit `rateLimit`, @better-auth/api-key falls back to its
 * default of 10 requests per 24 hours, and every key minted on the install is
 * stamped with that budget (`rateLimitMax` / `rateLimitTimeWindow` are written
 * onto the row at create time from the plugin's schema defaults), which locks
 * the CLI or a CI job out after its tenth call of the day.
 *
 * Expected: the configured limit is an explicit, documented value well above
 * ten a day, or the plugin's limiter is disabled in favour of the app's own.
 * The floor below (1,000/day, i.e. under one request a minute) is deliberately
 * modest so any reasonable explicit value clears it.
 *
 * Read off the REAL configured `auth` instance, the same plugin object the
 * server mounts, so the assertion tracks what new keys actually get.
 */
import { API_KEY_RATE_LIMIT_WINDOW_MS, auth } from "@otterdeploy/auth";
import { describe, expect, it } from "vite-plus/test";
import * as z from "zod";

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_REQUESTS_PER_DAY = 1000;

/** The defaults the plugin stamps onto every new `apikey` row. */
const apiKeyPluginDefaults = z.object({
  id: z.literal("api-key"),
  schema: z.object({
    apikey: z.object({
      fields: z.object({
        rateLimitEnabled: z.object({ defaultValue: z.boolean() }),
        rateLimitMax: z.object({ defaultValue: z.number() }),
        rateLimitTimeWindow: z.object({ defaultValue: z.number() }),
      }),
    }),
  }),
});

function apiKeyDefaults() {
  const plugin = auth.options.plugins.find((p) => p.id === "api-key");
  return apiKeyPluginDefaults.parse(plugin).schema.apikey.fields;
}

describe("API key rate limit", () => {
  it("the api-key plugin is mounted on the real auth instance", () => {
    expect(apiKeyDefaults().rateLimitMax.defaultValue).toBeGreaterThan(0);
  });

  it("a new API key allows well over 10 requests a day (explicit limit, or the plugin limiter disabled)", () => {
    const fields = apiKeyDefaults();
    if (!fields.rateLimitEnabled.defaultValue) return;
    // The window every new key is stamped with is the exported constant.
    expect(fields.rateLimitTimeWindow.defaultValue).toBe(API_KEY_RATE_LIMIT_WINDOW_MS);
    const perDay =
      fields.rateLimitMax.defaultValue * (DAY_MS / fields.rateLimitTimeWindow.defaultValue);
    expect(perDay).toBeGreaterThanOrEqual(MIN_REQUESTS_PER_DAY);
  });
});
