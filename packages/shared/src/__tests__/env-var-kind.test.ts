import { describe, expect, test } from "bun:test";

import { autofillValue, classifyEnvVar, isAutofilledKey, isSecretKey } from "../env-var-kind";

describe("classifyEnvVar", () => {
  test("credential-looking keys are secrets", () => {
    for (const key of [
      "APP_SECRET",
      "POSTGRES_PASSWORD",
      "JWT_TOKEN",
      "API_KEY",
      "APIKEY",
      "ACCESS_KEY",
      "PRIVATE_KEY",
      "SESSION_SALT",
      "WEBHOOK_SIGNING_KEY",
      "SENTRY_DSN",
    ]) {
      expect(classifyEnvVar(key), key).toBe("secret");
    }
  });

  test("address-looking keys are urls", () => {
    for (const key of ["SERVER_URL", "SITE_URL", "PUBLIC_ORIGIN", "BASE_URL", "API_ENDPOINT"]) {
      expect(classifyEnvVar(key), key).toBe("url");
    }
  });

  test("url wins over secret so NEXTAUTH_URL is not masked as a credential", () => {
    // `AUTH` matches the secret pattern. Without the precedence rule this
    // would be filled with random bytes and hidden behind a reveal toggle.
    // For a value that is just an address.
    expect(classifyEnvVar("NEXTAUTH_URL")).toBe("url");
    expect(classifyEnvVar("AUTH_DOMAIN")).toBe("url");
    expect(isSecretKey("NEXTAUTH_URL")).toBe(false);
  });

  test("bare host keys are hosts, not urls", () => {
    expect(classifyEnvVar("SERVER_HOST")).toBe("host");
    expect(classifyEnvVar("HOST")).toBe("host");
  });

  test("PGHOST is not a host ref, it names an internal service, not our edge", () => {
    // Word-boundary matching keeps `PGHOST`/`REDIS_HOSTNAME`-style compound
    // keys from being rewritten to the PUBLIC domain, which would point a
    // service at the internet instead of its sibling container.
    expect(classifyEnvVar("PGHOST")).toBe("plain");
  });

  test("`…_KEY` credentials are secrets", () => {
    for (const key of ["N8N_ENCRYPTION_KEY", "MEILI_MASTER_KEY", "TOTP_VAULT_KEY", "APP_KEY"]) {
      expect(classifyEnvVar(key), key).toBe("secret");
    }
  });

  test("keys that come from elsewhere are never generated", () => {
    // Random bytes here produce a field that LOOKS filled and is guaranteed
    // invalid: worse than blank, which at least tells the truth.
    for (const key of ["LICENSE_KEY", "PUBLIC_KEY", "SSH_KEY", "DEPLOY_KEY", "GPG_KEY"]) {
      expect(classifyEnvVar(key), key).toBe("plain");
    }
  });

  test("password spellings the main pattern misses", () => {
    for (const key of ["GATEWAY_MASTERPASS", "DB_PASS", "PASSPHRASE"]) {
      expect(classifyEnvVar(key), key).toBe("secret");
    }
    // Word-bounded: these merely contain the letters.
    for (const key of ["BYPASS_CACHE", "COMPASS_MODE"]) {
      expect(classifyEnvVar(key), key).toBe("plain");
    }
  });

  test("everything else is plain", () => {
    for (const key of ["TZ", "NODE_ENV", "LOG_LEVEL", "POSTGRES_DB", "REPLICAS"]) {
      expect(classifyEnvVar(key), key).toBe("plain");
    }
  });
});

describe("autofillValue", () => {
  const ctx = { randomSecret: () => "R4ND0M", publicHost: "twenty-acme.1.2.3.4.sslip.io" };

  test("secrets get a random value", () => {
    expect(autofillValue("APP_SECRET", ctx)).toBe("R4ND0M");
  });

  test("urls get https:// + the resolved host", () => {
    expect(autofillValue("SERVER_URL", ctx)).toBe("https://twenty-acme.1.2.3.4.sslip.io");
  });

  test("hosts get the bare fqdn", () => {
    expect(autofillValue("SERVER_HOST", ctx)).toBe("twenty-acme.1.2.3.4.sslip.io");
  });

  test("plain keys are never invented", () => {
    expect(autofillValue("TZ", ctx)).toBeNull();
  });

  // The whole point of the ref: the seeded value has to survive a domain
  // rename. A literal is correct exactly once, at install, and then silently
  // wrong for the rest of the stack's life.
  test("a known front service makes urls a reference, not a snapshot", () => {
    expect(autofillValue("SERVER_URL", { ...ctx, frontService: "twenty" })).toBe(
      "${{stack.twenty.PUBLIC_URL}}",
    );
  });

  test("a known front service makes hosts a reference too", () => {
    expect(autofillValue("SERVER_HOST", { ...ctx, frontService: "twenty" })).toBe(
      "${{stack.twenty.DOMAIN}}",
    );
  });

  test("secrets are unaffected by the front service", () => {
    expect(autofillValue("APP_SECRET", { ...ctx, frontService: "twenty" })).toBe("R4ND0M");
  });

  // No front door to point at (nothing exposed, or no service publishes a
  // port) → there is no `PUBLIC_URL` to resolve and referencing one would fail
  // the deploy. The literal is the honest fallback there.
  test("falls back to the literal host when no front service is exposed", () => {
    expect(autofillValue("SERVER_URL", { ...ctx, frontService: null })).toBe(
      "https://twenty-acme.1.2.3.4.sslip.io",
    );
  });

  test("an unknown host leaves address vars blank rather than guessing", () => {
    const noHost = { randomSecret: () => "R4ND0M", publicHost: null };
    expect(autofillValue("SERVER_URL", noHost)).toBeNull();
    expect(autofillValue("SERVER_HOST", noHost)).toBeNull();
    // Secrets don't depend on the host, so they still fill.
    expect(autofillValue("APP_SECRET", noHost)).toBe("R4ND0M");
  });
});

describe("isAutofilledKey", () => {
  test("matches what the wizard will actually seed", () => {
    expect(isAutofilledKey("APP_SECRET")).toBe(true);
    expect(isAutofilledKey("SERVER_URL")).toBe(true);
    expect(isAutofilledKey("TZ")).toBe(false);
  });
});

test("a product with `auth` in its name does not make every key a secret", () => {
  // Authentik's stack masked its own database name and username: `AUTH` was a
  // bare substring, so the prefix alone was enough to classify.
  expect(classifyEnvVar("AUTHENTIK_POSTGRESQL__NAME")).toBe("plain");
  expect(classifyEnvVar("AUTHENTIK_POSTGRESQL__USER")).toBe("plain");
  expect(isSecretKey("AUTHENTIK_POSTGRESQL__USER")).toBe(false);
});

test("the credentials of that same stack are still secrets", () => {
  expect(isSecretKey("AUTHENTIK_SECRET_KEY")).toBe(true);
  expect(isSecretKey("AUTHENTIK_POSTGRESQL__PASSWORD")).toBe(true);
});

test("`AUTH` as a whole word still counts", () => {
  expect(isSecretKey("AUTH")).toBe(true);
  expect(isSecretKey("BASIC_AUTH")).toBe(true);
  expect(isSecretKey("AUTH_TOKEN")).toBe(true);
});

/**
 * od-uini: the platform must never invent a credential a third party issues.
 *
 * Reported from a live install, where the variables editor showed
 * `RESEND_API_KEY = fahK-8LzYcuJ-p6HupBSUZ8XHkSHZ-wx`. That value is 32
 * plausible characters that Resend has never heard of. The container boots,
 * the field looks answered, nobody revisits it, and email is silently dead.
 *
 * The point of these tests is the BOUNDARY, not the rule: generating
 * `POSTGRES_PASSWORD` is correct and must keep working, because both sides of
 * that credential live inside the stack.
 */
describe("vendor-issued credentials are never generated", () => {
  const ctx = { randomSecret: () => "GENERATED", publicHost: "app.example.com" };

  test("does not invent the key that was reported", () => {
    expect(autofillValue("RESEND_API_KEY", ctx)).toBeNull();
  });

  test("still masks it: not generating is not the same as not secret", () => {
    expect(isSecretKey("RESEND_API_KEY")).toBe(true);
    expect(classifyEnvVar("RESEND_API_KEY")).toBe("secret");
  });

  test("does not promise a value it will not deliver", () => {
    // isAutofilledKey drives the catalog's "we fill this in for you" copy.
    expect(isAutofilledKey("RESEND_API_KEY")).toBe(false);
  });

  test("refuses across the vendors an app actually integrates with", () => {
    for (const key of [
      "STRIPE_SECRET_KEY",
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "TWILIO_AUTH_TOKEN",
      "SENDGRID_API_KEY",
      "AWS_SECRET_ACCESS_KEY",
      "SENTRY_DSN",
      "CLOUDFLARE_API_TOKEN",
      "GITHUB_TOKEN",
      "POSTHOG_API_KEY",
      "INFISICAL_CLIENT_SECRET",
    ]) {
      expect(autofillValue(key, ctx)).toBeNull();
    }
  });

  test("refuses an unlisted vendor by the shape of the key", () => {
    // No pattern distinguishes Resend from Meilisearch, so there is a vendor
    // list. But `API_KEY`/`DSN`/`CLIENT_SECRET` name a credential issued by
    // whatever the key points at, whoever that is.
    expect(autofillValue("ACME_API_KEY", ctx)).toBeNull();
    expect(autofillValue("SOMETHING_CLIENT_SECRET", ctx)).toBeNull();
  });

  test("STILL generates self-contained secrets, which is the whole point", () => {
    // Both sides of these live inside the stack: the value is whatever we say
    // it is. Breaking this would be a worse regression than the bug.
    for (const key of [
      "POSTGRES_PASSWORD",
      "DB_PASS",
      "APP_SECRET",
      "JWT_SECRET",
      "MEILI_MASTER_KEY",
      "N8N_ENCRYPTION_KEY",
      "AUTH_SECRET",
    ]) {
      expect(autofillValue(key, ctx)).toBe("GENERATED");
      expect(isAutofilledKey(key)).toBe(true);
    }
  });

  test("treats SECRET_KEY_BASE as the secret it is (od-9slm)", () => {
    // It matches the ambiguous `BASE` address word on its tail, and URL beats
    // secret, so it used to classify as an address: unmasked, and seeded with
    // an https:// string. A session-signing key in the clear with a guessable
    // value.
    expect(classifyEnvVar("SECRET_KEY_BASE")).toBe("secret");
    expect(isSecretKey("SECRET_KEY_BASE")).toBe(true);
    expect(autofillValue("SECRET_KEY_BASE", ctx)).toBe("GENERATED");
  });

  test("BASE still means an address when nothing contradicts it", () => {
    // The word earns its place: nothing else in the address pattern catches
    // these, and breaking them would trade one bug for another.
    expect(classifyEnvVar("API_BASE")).toBe("url");
    expect(classifyEnvVar("PUBLIC_BASE")).toBe("url");
    expect(classifyEnvVar("BASE_URL")).toBe("url");
  });

  test("only SECRET and PASSWORD override it, not every credential word", () => {
    // `TOKEN_ENDPOINT` and `..._KEY_...` shapes appear in real address names.
    // Yielding on those would mirror the bug instead of fixing it.
    expect(classifyEnvVar("TOKEN_ENDPOINT")).toBe("url");
    expect(classifyEnvVar("PASSWORD_BASE")).toBe("secret");
  });

  test("leaves addresses alone", () => {
    // A vendor name in a URL is still a URL: SUPABASE_URL is an address, not a
    // credential, and must not be caught by any of this.
    expect(classifyEnvVar("SUPABASE_URL")).toBe("url");
    expect(autofillValue("SUPABASE_URL", ctx)).toBe("https://app.example.com");
  });
});
