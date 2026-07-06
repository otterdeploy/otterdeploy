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
});
