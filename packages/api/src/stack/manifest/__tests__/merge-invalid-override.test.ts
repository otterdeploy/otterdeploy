/**
 * An environment block that does not merge into a valid manifest is the
 * operator's mistake, and it has to arrive as one.
 *
 * `resolveEnvironment` used to `throw new Error(...)` on this, and both of its
 * callers invoked it inside `Result.ok(resolveEnvironment(...))` — so the throw
 * escaped the Result contract entirely and left the handler as an uncaught
 * exception. The manifest `diff`, `apply` and `applyChange` endpoints therefore
 * answered a malformed environment override with a 500, for a document the
 * operator could have fixed had anything told them which resource was wrong.
 * The old message named neither: "overrides merge into invalid services".
 *
 * Now it is a typed `ManifestMergeError` carrying the zod issues, which the
 * handlers map to the 400 `INVALID_MANIFEST`.
 */
import { describe, expect, it } from "vite-plus/test";

import { ManifestMergeError, resolveEnvironment } from "../merge";
import { manifestSchema, type Manifest } from "../schema";

function manifest(document: Record<string, unknown>): Manifest {
  return manifestSchema.parse({ project: "acme-api", ...document });
}

const web = { source: "image", image: "nginx" } as const;

describe("an environment override that does not merge cleanly", () => {
  it("returns an error instead of throwing", () => {
    // `ghost` exists only in staging and never declares `source`, so the
    // merged services map is not a valid services map.
    const document = manifest({
      services: { web },
      environments: { staging: { services: { ghost: { image: "x" } } } },
    });

    // The point of the change: this call does not throw.
    const result = resolveEnvironment(document, "staging");

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error).toBeInstanceOf(ManifestMergeError);
    expect(result.error._tag).toBe("ManifestMergeError");
  });

  it("names the environment, the map, and the offending resource", () => {
    const result = resolveEnvironment(
      manifest({
        services: { web },
        environments: { staging: { services: { ghost: { image: "x" } } } },
      }),
      "staging",
    );

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    const { environment, map, issues, message } = result.error;
    expect(environment).toBe("staging");
    expect(map).toBe("services");
    // The old error said only "invalid services". An operator needs the name.
    expect(issues.join("\n")).toContain("ghost");
    expect(message).toContain("staging");
    expect(message).toContain("ghost");
  });

  it("reports a database override the same way", () => {
    const result = resolveEnvironment(
      manifest({
        databases: { primary: { engine: "postgres" } },
        // `cache` exists only in staging and never says which engine it is.
        environments: { staging: { databases: { cache: { version: "7" } } } },
      }),
      "staging",
    );

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error.map).toBe("databases");
    expect(result.error.issues.join("\n")).toContain("cache");
  });

  it("still returns the merged manifest when the override is valid", () => {
    const result = resolveEnvironment(
      manifest({
        services: { web },
        environments: { staging: { services: { web: { replicas: 3 } } } },
      }),
      "staging",
    );

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value.services.web).toMatchObject({ source: "image", replicas: 3 });
  });

  it("is a no-op, not an error, for an environment with no block", () => {
    const document = manifest({ services: { web } });
    const result = resolveEnvironment(document, "nonexistent");
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toEqual(document);
  });
});
