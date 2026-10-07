/**
 * Passkeys work on the host the browser is on.
 *
 * The first block pins the pure pieces; the second runs the REAL passkey
 * plugin behind the REAL hook in a throwaway better-auth instance whose
 * configured URL is a bare IP, exactly the default install that was
 * broken, and asks it for registration options through `localhost`.
 */
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuthMiddleware } from "better-auth/api";
import { describe, expect, test } from "bun:test";
import * as z from "zod";

import { bindPasskeyRelyingParty, passkeyRelyingPartyBase } from "../passkey-rp";

describe("passkeyRelyingPartyBase", () => {
  test("names the host the request reached", () => {
    expect(passkeyRelyingPartyBase(new Headers({ host: "localhost:8443" }))).toBe(
      "https://localhost:8443",
    );
    expect(passkeyRelyingPartyBase(new Headers({ host: "Dash.Example.com" }))).toBe(
      "https://dash.example.com",
    );
  });

  test("declines a request with no usable host", () => {
    expect(passkeyRelyingPartyBase(undefined)).toBeNull();
    expect(passkeyRelyingPartyBase(new Headers())).toBeNull();
    // A host header carrying a path is not a host.
    expect(passkeyRelyingPartyBase(new Headers({ host: "evil.com/x" }))).toBeNull();
  });
});

describe("bindPasskeyRelyingParty", () => {
  test("rebinds only this request's copy, only on ceremony paths", () => {
    const shared = { baseURL: "http://203.0.113.10:3000", appName: "otterdeploy" };
    const ctx = {
      path: "/passkey/generate-register-options",
      headers: new Headers({ host: "localhost:8443" }),
      context: { options: shared },
    };
    bindPasskeyRelyingParty(ctx);
    expect(ctx.context.options.baseURL).toBe("https://localhost:8443");
    expect(ctx.context.options.appName).toBe("otterdeploy");
    // The install-wide options object is untouched.
    expect(shared.baseURL).toBe("http://203.0.113.10:3000");

    const other = { path: "/sign-in/email", headers: ctx.headers, context: { options: shared } };
    bindPasskeyRelyingParty(other);
    expect(other.context.options).toBe(shared);
  });
});

const optionsSchema = z.object({ rp: z.object({ id: z.string() }) });
const INSTALL_URL = "http://203.0.113.10:3000";

function createTestAuth() {
  return betterAuth({
    baseURL: INSTALL_URL,
    secret: "passkey-rp-test-secret-0123456789abcdef",
    database: memoryAdapter({ user: [], session: [], account: [], verification: [], passkey: [] }),
    emailAndPassword: { enabled: true },
    plugins: [passkey({ rpName: "otterdeploy" })],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        bindPasskeyRelyingParty(ctx);
      }),
    },
  });
}

async function registerOptionsVia(host: string): Promise<string> {
  const auth = createTestAuth();
  const signedUp = await auth.api.signUpEmail({
    body: { name: "Operator", email: "operator@example.com", password: "correct-horse-1" },
    asResponse: true,
  });
  expect(signedUp.status).toBe(200);
  const cookie = signedUp.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const response = await auth.handler(
    new Request(`http://${host}/api/auth/passkey/generate-register-options`, {
      headers: { host, cookie },
    }),
  );
  expect(response.status).toBe(200);
  return optionsSchema.parse(await response.json()).rp.id;
}

describe("the passkey plugin behind the hook", () => {
  test("issues options for the host the dashboard is opened on, not BETTER_AUTH_URL's", async () => {
    // Through an SSH tunnel to a default install: the secure origin an
    // operator actually has. Before the fix this answered 203.0.113.10.
    expect(await registerOptionsVia("localhost:8443")).toBe("localhost");
    // And on a domain added after install.
    expect(await registerOptionsVia("dash.example.com")).toBe("dash.example.com");
  });
});
