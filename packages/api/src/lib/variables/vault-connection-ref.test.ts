/**
 * od-lvtx: the provider connection's own credentials are referenceable.
 *
 * The behaviour under test is small, but two properties in it are load-bearing
 * and easy to regress:
 *
 *   - an unset optional field FAILS rather than resolving to "". A blank value
 *     injected into a container's environment is indistinguishable from a
 *     working one until the app tries to authenticate with it.
 *   - the reserved prefix is matched on the ref, not on the provider kind, so
 *     an ordinary secret name is never mistaken for a connection field.
 */
import { describe, expect, it } from "vite-plus/test";

import {
  CONNECTION_REF_PREFIX,
  connectionFieldsFor,
  isConnectionRef,
  resolveConnectionRef,
  type ConnectionSource,
} from "./vault-connection-ref";

const infisical: ConnectionSource = {
  kind: "infisical",
  config: {
    clientId: "uauth-client-1",
    siteUrl: "https://app.infisical.com",
    projectId: "proj_9",
    environmentSlug: "prod",
  },
  credential: "uauth-secret-1",
};

describe("isConnectionRef", () => {
  it("only matches the reserved prefix", () => {
    expect(isConnectionRef(`${CONNECTION_REF_PREFIX}client_id`)).toBe(true);
    // The names the Praxly deploy actually tried, which must stay ordinary
    // secret lookups against the provider.
    expect(isConnectionRef("INFISICAL_CLIENT_SECRET")).toBe(false);
    expect(isConnectionRef("path/to/secret:field")).toBe(false);
  });
});

describe("resolveConnectionRef", () => {
  it("resolves the Infisical bootstrap pair, the case this exists for", () => {
    const id = resolveConnectionRef(infisical, `${CONNECTION_REF_PREFIX}client_id`);
    const secret = resolveConnectionRef(infisical, `${CONNECTION_REF_PREFIX}client_secret`);

    expect(id).toEqual({ ok: true, value: "uauth-client-1" });
    expect(secret).toEqual({ ok: true, value: "uauth-secret-1" });
  });

  it("exposes the secret half under a kind-neutral name too", () => {
    expect(resolveConnectionRef(infisical, `${CONNECTION_REF_PREFIX}credential`)).toEqual({
      ok: true,
      value: "uauth-secret-1",
    });
  });

  it("reads non-secret config fields", () => {
    expect(resolveConnectionRef(infisical, `${CONNECTION_REF_PREFIX}site_url`)).toEqual({
      ok: true,
      value: "https://app.infisical.com",
    });
  });

  it("fails on an unset optional field instead of exporting an empty string", () => {
    const result = resolveConnectionRef(infisical, `${CONNECTION_REF_PREFIX}secret_path`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain("no secret_path configured");
  });

  it("fails on an empty stored credential", () => {
    const result = resolveConnectionRef(
      { ...infisical, credential: "" },
      `${CONNECTION_REF_PREFIX}client_secret`,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain("empty");
  });

  it("rejects a field belonging to a different provider kind, and lists the real ones", () => {
    // `token` is Vault/Doppler vocabulary; an Infisical connection has none.
    const result = resolveConnectionRef(infisical, `${CONNECTION_REF_PREFIX}token`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.detail).toContain("not a connection field");
      expect(result.detail).toContain(`${CONNECTION_REF_PREFIX}client_id`);
    }
  });

  it("covers the other two provider kinds", () => {
    const hashicorp: ConnectionSource = {
      kind: "hashicorp",
      config: { url: "https://vault.internal", mount: "secret" },
      credential: "hvs.token",
    };
    const doppler: ConnectionSource = {
      kind: "doppler",
      config: { dopplerProject: "praxly", dopplerConfig: "prd" },
      credential: "dp.st.token",
    };

    expect(resolveConnectionRef(hashicorp, `${CONNECTION_REF_PREFIX}token`)).toEqual({
      ok: true,
      value: "hvs.token",
    });
    expect(resolveConnectionRef(hashicorp, `${CONNECTION_REF_PREFIX}mount`)).toEqual({
      ok: true,
      value: "secret",
    });
    expect(resolveConnectionRef(doppler, `${CONNECTION_REF_PREFIX}project`)).toEqual({
      ok: true,
      value: "praxly",
    });
  });
});

describe("connectionFieldsFor", () => {
  it("always includes the kind-neutral credential alias", () => {
    for (const kind of ["infisical", "hashicorp", "doppler"] as const) {
      expect(connectionFieldsFor(kind)).toContain("credential");
    }
  });

  it("does not leak one kind's vocabulary into another", () => {
    expect(connectionFieldsFor("infisical")).not.toContain("token");
    expect(connectionFieldsFor("doppler")).not.toContain("client_id");
  });
});
