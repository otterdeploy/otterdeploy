/**
 * The builder reads a stored registry credential in the format the
 * API writes it.
 *
 * `registry.create`/`registry.update` store the password as a v2
 * domain-separated envelope (`encryptForDomain(..., "registry-creds")`), and
 * the key-rotation script re-keys old v1 rows into the same shape. The builder
 * must read both: the current v2 envelope decrypts, a legacy v1 row still
 * does, and another domain's envelope is refused.
 */
import { describe, expect, it } from "vite-plus/test";

// oxlint-disable-next-line node/no-process-env -- test env setup boundary: the crypto module validates env at import; satisfy the required vars before the dynamic imports below.
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
// oxlint-disable-next-line node/no-process-env -- test env setup boundary (see above).
process.env.REDIS_URL ??= "redis://localhost:6379";
// oxlint-disable-next-line node/no-process-env -- test env setup boundary (see above).
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
// oxlint-disable-next-line node/no-process-env -- test env setup boundary (see above).
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123456789";
// oxlint-disable-next-line node/no-process-env -- test env setup boundary (see above).
process.env.CORS_ORIGIN ??= "http://localhost:3000";

const { encryptForDomain, encryptSecret } = await import("@otterdeploy/api/lib/crypto");
const { resolvePushCredentials } = await import("../registry-credential");

function storedSource(encryptedPassword: string) {
  return {
    kind: "stored" as const,
    host: "registry.example.test",
    username: "deploy-bot",
    encryptedPassword,
  };
}

describe("resolvePushCredentials decrypts a stored registry credential", () => {
  it("a credential encrypted the way the API writes it (v2 registry-creds) decrypts", async () => {
    const encrypted = await encryptForDomain("s3cret-pat", "registry-creds");
    expect(encrypted.startsWith("v2:registry-creds:")).toBe(true);
    expect(await resolvePushCredentials(storedSource(encrypted))).toEqual({
      host: "registry.example.test",
      username: "deploy-bot",
      password: "s3cret-pat",
    });
  });

  it("a legacy v1 credential still decrypts", async () => {
    const encrypted = await encryptSecret("legacy-password");
    expect(encrypted.startsWith("v1.")).toBe(true);
    const creds = await resolvePushCredentials(storedSource(encrypted));
    expect(creds.password).toBe("legacy-password");
  });

  it("a v2 envelope from another secret domain is refused, not decrypted", async () => {
    const encrypted = await encryptForDomain("an-ssh-key", "ssh-keys");
    await expect(resolvePushCredentials(storedSource(encrypted))).rejects.toThrow(
      /domain mismatch/,
    );
  });
});
