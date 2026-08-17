/**
 * The env-seeds / DB-owns contract, which every setting moved out of `.env`
 * (od-gfg) depends on. The subtle cases are the falsy ones: `false`, `0` and
 * `""` are real operator choices that must beat a non-empty env value, and
 * only NULL may fall back. Getting that backwards would make "disable idle
 * teardown", "turn off edge-log persistence" and "allow no egress at all"
 * silently impossible to express from the UI.
 */

import type { JsonObject } from "@otterdeploy/shared/json";

import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

const selectRow = vi.fn<() => unknown>();

vi.mock("@otterdeploy/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => selectRow(),
        }),
      }),
    }),
  },
}));

vi.mock("@otterdeploy/env/server", () => ({
  env: {
    OTTERDEPLOY_EGRESS_ALLOWLIST: ["10.0.0.0/8"],
    PREVIEW_IDLE_TEARDOWN_HOURS: 72,
    EDGE_LOG_PERSIST: true,
    EDGE_LOG_GEOIP_URL: "https://env.example/country.mmdb",
    EDGE_LOG_GEOIP_ASN_URL: "https://env.example/asn.mmdb",
    BUILDER_CONCURRENCY: 1,
    CROWDSEC_LAPI_URL: "http://crowdsec:8080",
    CROWDSEC_BOUNCER_KEY: "env-bouncer-key",
    TWILIO_ACCOUNT_SID: "AC-env",
    TWILIO_AUTH_TOKEN: "env-token",
    TWILIO_FROM_NUMBER: "+15550000000",
    FCM_SERVER_KEY: "env-fcm",
    GITHUB_OAUTH_CLIENT_ID: undefined,
    GITHUB_OAUTH_CLIENT_SECRET: undefined,
    GOOGLE_OAUTH_CLIENT_ID: undefined,
    GOOGLE_OAUTH_CLIENT_SECRET: undefined,
    GITLAB_OAUTH_CLIENT_ID: undefined,
    GITLAB_OAUTH_CLIENT_SECRET: undefined,
    GITLAB_OAUTH_ISSUER: undefined,
  },
}));

vi.mock("../crypto", () => ({
  decryptSecret: (blob: string) => Promise.resolve(`decrypted:${blob}`),
}));

import {
  builderConcurrency,
  crowdsecConfig,
  edgeLogPersistEnabled,
  edgeLogRetentionDays,
  egressAllowlistEntries,
  invalidatePlatformRuntimeSettings,
  previewIdleTeardownHours,
  registrationPolicy,
  resolvedSocialProviders,
  twilioConfig,
} from "../platform-runtime-settings";

/** Stand in for the settings row; `undefined` = no row at all (fresh install). */
function withRow(row: JsonObject | undefined) {
  selectRow.mockResolvedValue(row === undefined ? [] : [row]);
  invalidatePlatformRuntimeSettings();
}

beforeEach(() => {
  selectRow.mockReset();
  invalidatePlatformRuntimeSettings();
});

describe("env fallback when the column is null", () => {
  test("a fresh install with no settings row resolves entirely from env", async () => {
    withRow(undefined);
    expect(await egressAllowlistEntries()).toEqual(["10.0.0.0/8"]);
    expect(await previewIdleTeardownHours()).toBe(72);
    expect(await edgeLogPersistEnabled()).toBe(true);
    expect(await builderConcurrency()).toBe(1);
  });

  test("an existing row with null columns still defers to env", async () => {
    withRow({
      egressAllowlist: null,
      previewIdleTeardownHours: null,
      edgeLogPersist: null,
      builderConcurrency: null,
    });
    expect(await egressAllowlistEntries()).toEqual(["10.0.0.0/8"]);
    expect(await previewIdleTeardownHours()).toBe(72);
    expect(await edgeLogPersistEnabled()).toBe(true);
    expect(await builderConcurrency()).toBe(1);
  });

  test("retention has no env var, so it falls back to the documented default", async () => {
    withRow({ edgeLogRetentionDays: null });
    expect(await edgeLogRetentionDays()).toBe(7);
  });
});

describe("stored falsy values are real choices, not absences", () => {
  test('an empty allowlist means "allow nothing", overriding a non-empty env', async () => {
    withRow({ egressAllowlist: "" });
    expect(await egressAllowlistEntries()).toEqual([]);
  });

  test("0 hours disables preview idle teardown even though env says 72", async () => {
    withRow({ previewIdleTeardownHours: 0 });
    expect(await previewIdleTeardownHours()).toBe(0);
  });

  test("false disables edge-log persistence even though env enables it", async () => {
    withRow({ edgeLogPersist: false });
    expect(await edgeLogPersistEnabled()).toBe(false);
  });
});

describe("allowlist parsing matches the env transform", () => {
  test("trims entries and drops empties", async () => {
    withRow({ egressAllowlist: " 192.168.1.5 , ,10.1.0.0/16 " });
    expect(await egressAllowlistEntries()).toEqual(["192.168.1.5", "10.1.0.0/16"]);
  });
});

describe("registration policy fails closed", () => {
  test('only the literal "open" opens registration', async () => {
    withRow({ registrationMode: "open" });
    expect(await registrationPolicy()).toBe("open");
  });

  test.each([[null], ["invite-only"], ["Open"], ["anything-else"]])(
    "%p resolves to invite-only",
    async (mode) => {
      withRow({ registrationMode: mode });
      expect(await registrationPolicy()).toBe("invite-only");
    },
  );

  test("no settings row at all is invite-only", async () => {
    withRow(undefined);
    expect(await registrationPolicy()).toBe("invite-only");
  });
});

describe("CrowdSec", () => {
  test("resolves from env when nothing is stored", async () => {
    withRow(undefined);
    expect(await crowdsecConfig()).toEqual({
      apiUrl: "http://crowdsec:8080",
      apiKey: "env-bouncer-key",
    });
  });

  test("an explicit off-switch wins over present credentials", async () => {
    withRow({ crowdsecEnabled: false, crowdsecLapiUrl: "http://stored:8080" });
    expect(await crowdsecConfig()).toBeNull();
  });

  test("a stored key is decrypted and takes precedence over env", async () => {
    withRow({
      crowdsecLapiUrl: "http://stored:8080",
      crowdsecBouncerKeyCiphertext: "blob",
    });
    expect(await crowdsecConfig()).toEqual({
      apiUrl: "http://stored:8080",
      apiKey: "decrypted:blob",
    });
  });
});

describe("Twilio", () => {
  test("mixes a stored SID with the env token. Each field resolves on its own", async () => {
    withRow({ twilioAccountSid: "AC-stored" });
    expect(await twilioConfig()).toEqual({
      accountSid: "AC-stored",
      authToken: "env-token",
      fromNumber: "+15550000000",
    });
  });
});

describe("social providers", () => {
  test("a provider with no credentials from either source is omitted", async () => {
    withRow(undefined);
    expect(await resolvedSocialProviders()).toEqual([]);
  });

  test("a half-configured provider is skipped rather than registered broken", async () => {
    withRow({ githubOauthClientId: "id-only" });
    expect(await resolvedSocialProviders()).toEqual([]);
  });

  test("a fully-stored provider resolves with its secret decrypted", async () => {
    withRow({
      githubOauthClientId: "gh-id",
      githubOauthClientSecretCiphertext: "gh-blob",
    });
    expect(await resolvedSocialProviders()).toEqual([
      { id: "github", clientId: "gh-id", clientSecret: "decrypted:gh-blob" },
    ]);
  });

  test("an explicit disable removes an otherwise-complete provider", async () => {
    withRow({
      githubOauthEnabled: false,
      githubOauthClientId: "gh-id",
      githubOauthClientSecretCiphertext: "gh-blob",
    });
    expect(await resolvedSocialProviders()).toEqual([]);
  });

  test("gitlab carries its self-hosted issuer through", async () => {
    withRow({
      gitlabOauthClientId: "gl-id",
      gitlabOauthClientSecretCiphertext: "gl-blob",
      gitlabOauthIssuer: "https://gitlab.acme.com",
    });
    expect(await resolvedSocialProviders()).toEqual([
      {
        id: "gitlab",
        clientId: "gl-id",
        clientSecret: "decrypted:gl-blob",
        issuer: "https://gitlab.acme.com",
      },
    ]);
  });
});

describe("caching", () => {
  test("repeated reads collapse onto one query until invalidated", async () => {
    withRow({ previewIdleTeardownHours: 5 });
    await previewIdleTeardownHours();
    await previewIdleTeardownHours();
    await previewIdleTeardownHours();
    expect(selectRow).toHaveBeenCalledTimes(1);

    // A writer calls this; without it a saved setting would look like it
    // never applied until the TTL expired.
    invalidatePlatformRuntimeSettings();
    await previewIdleTeardownHours();
    expect(selectRow).toHaveBeenCalledTimes(2);
  });
});
