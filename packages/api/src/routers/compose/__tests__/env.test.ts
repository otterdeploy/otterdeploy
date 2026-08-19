import { describe, expect, it } from "vite-plus/test";

import { collectVarRefs, interpolate, substituteComposeEnv } from "../env";

describe("collectVarRefs", () => {
  it("collects ${VAR} refs across image/command/env, with defaults", () => {
    const refs = collectVarRefs({
      services: [
        {
          image: "${SERVER_IMAGE:-ghcr.io/acme/app}:${IMAGE_TAG:-latest}",
          command: ["--port", "${PORT}"],
          entrypoint: null,
          env: { DATABASE_URL: "${DATABASE_URL}" },
        },
      ],
    });
    const byName = Object.fromEntries(refs.map((r) => [r.name, r.default]));
    expect(byName.SERVER_IMAGE).toBe("ghcr.io/acme/app");
    expect(byName.IMAGE_TAG).toBe("latest");
    expect(byName.PORT).toBeNull(); // no default → required
    expect(byName.DATABASE_URL).toBeNull();
  });
});

describe("interpolate", () => {
  it("resolves ${VAR:-default} in an image ref", () => {
    // the reported bug: image used compose interpolation, deployed raw to swarm.
    const img = "${SERVER_IMAGE:-ghcr.io/kaitosec/kaitosec-server}:${IMAGE_TAG:-latest}";
    expect(interpolate(img, {})).toBe("ghcr.io/kaitosec/kaitosec-server:latest");
    expect(interpolate(img, { SERVER_IMAGE: "my/app", IMAGE_TAG: "v2" })).toBe("my/app:v2");
  });
});

describe("substituteComposeEnv", () => {
  it("resolves refs, defaults, escapes, and reports missing", () => {
    const { env, missing } = substituteComposeEnv(
      {
        URL: "postgres://${DB_HOST}:5432",
        PORT: "${PORT:-3000}",
        LITERAL: "price is $${AMOUNT}",
        GONE: "${NOPE}",
      },
      { DB_HOST: "db.internal" },
    );
    expect(env.URL).toBe("postgres://db.internal:5432");
    expect(env.PORT).toBe("3000"); // default used
    expect(env.LITERAL).toBe("price is ${AMOUNT}"); // escaped
    expect(env.GONE).toBe(""); // missing → empty
    expect(missing).toEqual(["NOPE"]);
  });

  it("passes `${{…}}` platform refs through untouched", () => {
    // Two different grammars share the `$`: compose's `${VAR}` resolves HERE
    // against the project bag, the platform's `${{…}}` resolves LATER against
    // resources. Every template in the catalog now depends on the second
    // surviving the first intact — a `${{` eaten here would deploy a service
    // pointed at a hostname that is the empty string.
    const { env, missing } = substituteComposeEnv(
      {
        DATABASE_URL: "postgres://u:${POSTGRES_PASSWORD}@${{stack.db.HOST}}:5432/app",
        HOST: "${{autumn.db.HOST}}",
      },
      { POSTGRES_PASSWORD: "pw" },
    );
    expect(env.DATABASE_URL).toBe("postgres://u:pw@${{stack.db.HOST}}:5432/app");
    expect(env.HOST).toBe("${{autumn.db.HOST}}");
    expect(missing).toEqual([]);
  });
});

describe("collectVarRefs: platform refs", () => {
  it("does not mistake `${{…}}` for a required compose variable", () => {
    // Otherwise every stack-scoped template would demand a project variable
    // named `stack` before the wizard let you deploy it.
    const refs = collectVarRefs({
      services: [
        {
          image: "app:1",
          command: null,
          entrypoint: null,
          env: { URL: "http://${{stack.db.HOST}}:5432", REAL: "${NEEDED}" },
        },
      ],
    });
    expect(refs.map((r) => r.name)).toEqual(["NEEDED"]);
  });
});
