import { describe, expect, test } from "bun:test";

import {
  captureOpenAPISpec,
  loadOpenAPISpec,
  OpenAPISpecError,
  resolveConfiguredOpenAPISpecUrl,
  resolveOpenAPISpecEnvironment,
  resolveOpenAPISpecUrl,
} from "../openapi-loader";

const validSpec = {
  openapi: "3.1.0",
  info: { title: "otterdeploy API", version: "1.0.0" },
  paths: {
    "/projects": {
      get: { responses: { "200": { description: "OK" } } },
    },
  },
};

async function rejectionOf(promise: Promise<unknown>): Promise<() => void> {
  try {
    await promise;
  } catch (error) {
    return () => {
      throw error;
    };
  }
  return () => undefined;
}

describe("resolveOpenAPISpecUrl", () => {
  test("uses the local control plane in development", () => {
    expect(resolveOpenAPISpecUrl(undefined, "development")).toBe(
      "http://localhost:3000/api/reference/spec.json",
    );
  });

  test("requires an explicit source in production", () => {
    expect(() => resolveOpenAPISpecUrl(undefined, "production")).toThrow(OpenAPISpecError);
  });

  test("rejects non-HTTP sources", () => {
    expect(() => resolveOpenAPISpecUrl("file:///tmp/openapi.json", "production")).toThrow(
      "must use HTTP or HTTPS",
    );
  });

  test("rejects a plaintext remote source in production", () => {
    expect(() =>
      resolveOpenAPISpecUrl("http://deploy.example.com/api/reference/spec.json", "production"),
    ).toThrow("must use HTTPS in production unless it targets loopback");
  });

  test("allows a loopback fixture during a production-mode build", () => {
    expect(resolveOpenAPISpecUrl("http://127.0.0.1:8790/spec.json", "production")).toBe(
      "http://127.0.0.1:8790/spec.json",
    );
  });
});

describe("resolveConfiguredOpenAPISpecUrl", () => {
  test("prefers the current variable and trims it", () => {
    expect(
      resolveConfiguredOpenAPISpecUrl(
        " https://current.example/spec.json ",
        "https://legacy.example/spec.json",
      ),
    ).toBe("https://current.example/spec.json");
  });

  test("keeps the legacy variable as a compatibility fallback", () => {
    expect(resolveConfiguredOpenAPISpecUrl("  ", " https://legacy.example/spec.json ")).toBe(
      "https://legacy.example/spec.json",
    );
  });
});

describe("resolveOpenAPISpecEnvironment", () => {
  test("gives exported variables precedence across current and legacy aliases", () => {
    expect(
      resolveOpenAPISpecEnvironment(
        { OTTERSTACK_OPENAPI_SPEC_URL: "https://exported.example/spec.json" },
        { OTTERDEPLOY_OPENAPI_SPEC_URL: "https://file.example/spec.json" },
      ),
    ).toBe("https://exported.example/spec.json");
  });

  test("falls back to the current name from the root environment files", () => {
    expect(
      resolveOpenAPISpecEnvironment(
        {},
        { OTTERDEPLOY_OPENAPI_SPEC_URL: " https://file.example/spec.json " },
      ),
    ).toBe("https://file.example/spec.json");
  });
});

describe("loadOpenAPISpec", () => {
  test("loads a valid document with at least one operation", async () => {
    let requestedUrl = "";
    let requestInit: RequestInit | undefined;
    const loaded = await loadOpenAPISpec({
      environment: "production",
      specUrl: " https://deploy.example.com/api/reference/spec.json ",
      fetcher: async (url, init) => {
        requestedUrl = url;
        requestInit = init;
        return Response.json(validSpec);
      },
    });

    expect(requestedUrl).toBe("https://deploy.example.com/api/reference/spec.json");
    expect(requestInit?.redirect).toBe("error");
    expect(loaded).toEqual({
      ...validSpec,
      servers: [{ url: "https://deploy.example.com/api/reference" }],
    });
  });

  test("allows self-contained JSON Pointer references", async () => {
    const spec = {
      ...validSpec,
      paths: {
        "/projects": {
          get: {
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Project" },
                  },
                },
              },
            },
          },
        },
      },
      components: { schemas: { Project: { type: "object" } } },
    };
    const loaded = await loadOpenAPISpec({
      environment: "production",
      specUrl: "https://deploy.example.com/api/reference/spec.json",
      fetcher: async () => Response.json(spec),
    });

    expect(loaded).toEqual({
      ...spec,
      servers: [{ url: "https://deploy.example.com/api/reference" }],
    });
  });

  test("replaces an upstream-downgraded server URL with the configured public origin", async () => {
    const loaded = await loadOpenAPISpec({
      environment: "production",
      specUrl: "https://deploy.example.com:8443/api/reference/spec.json",
      fetcher: async () =>
        Response.json({
          ...validSpec,
          servers: [{ url: "http://deploy.example.com/api/reference" }],
        }),
    });

    expect(loaded.servers).toEqual([{ url: "https://deploy.example.com:8443/api/reference" }]);
  });

  test("rejects an HTTP error instead of publishing an empty reference", async () => {
    const loading = loadOpenAPISpec({
      environment: "production",
      specUrl: "https://deploy.example.com/api/reference/spec.json",
      fetcher: async () => new Response("unavailable", { status: 503 }),
    });

    expect(await rejectionOf(loading)).toThrow("request failed with 503");
  });

  test("rejects malformed documents", async () => {
    const loading = loadOpenAPISpec({
      environment: "production",
      specUrl: "https://deploy.example.com/api/reference/spec.json",
      fetcher: async () => Response.json({ ok: true }),
    });

    expect(await rejectionOf(loading)).toThrow("not a supported OpenAPI 3.0-3.2 document");
  });

  test("rejects malformed OpenAPI version strings", async () => {
    const loading = loadOpenAPISpec({
      environment: "production",
      specUrl: "https://deploy.example.com/api/reference/spec.json",
      fetcher: async () => Response.json({ ...validSpec, openapi: "3.invalid" }),
    });

    expect(await rejectionOf(loading)).toThrow("not a supported OpenAPI 3.0-3.2 document");
  });

  test("rejects unsupported future OpenAPI minor versions", async () => {
    const loading = loadOpenAPISpec({
      environment: "production",
      specUrl: "https://deploy.example.com/api/reference/spec.json",
      fetcher: async () => Response.json({ ...validSpec, openapi: "3.999.0" }),
    });

    expect(await rejectionOf(loading)).toThrow("not a supported OpenAPI 3.0-3.2 document");
  });

  test("rejects a structurally valid document with no operations", async () => {
    const loading = loadOpenAPISpec({
      environment: "production",
      specUrl: "https://deploy.example.com/api/reference/spec.json",
      fetcher: async () => Response.json({ ...validSpec, paths: {} }),
    });

    expect(await rejectionOf(loading)).toThrow("refusing to publish an empty reference");
  });

  test("does not count a non-object method value as an operation", async () => {
    const loading = loadOpenAPISpec({
      environment: "production",
      specUrl: "https://deploy.example.com/api/reference/spec.json",
      fetcher: async () => Response.json({ ...validSpec, paths: { "/projects": { get: null } } }),
    });

    expect(await rejectionOf(loading)).toThrow("refusing to publish an empty reference");
  });

  test("rejects remote references before Fumadocs can fetch them", async () => {
    const loading = loadOpenAPISpec({
      environment: "production",
      specUrl: "https://deploy.example.com/api/reference/spec.json",
      fetcher: async () =>
        Response.json({
          ...validSpec,
          components: {
            schemas: { Project: { $ref: "https://internal.example/project.json" } },
          },
        }),
    });

    expect(await rejectionOf(loading)).toThrow("external references are not allowed");
  });

  test("rejects file references before Fumadocs can read them", async () => {
    const loading = loadOpenAPISpec({
      environment: "production",
      specUrl: "https://deploy.example.com/api/reference/spec.json",
      fetcher: async () =>
        Response.json({
          ...validSpec,
          components: { schemas: { Project: { $ref: "file:///etc/passwd" } } },
        }),
    });

    expect(await rejectionOf(loading)).toThrow("external references are not allowed");
  });

  test("aborts a slow source at the configured deadline", async () => {
    const loading = loadOpenAPISpec({
      environment: "production",
      specUrl: "https://deploy.example.com/api/reference/spec.json",
      timeoutMs: 5,
      fetcher: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        }),
    });

    expect(await rejectionOf(loading)).toThrow("timed out after 5ms");
  });
});

describe("captureOpenAPISpec", () => {
  test("allows an intentional overview-only production build when no URL is configured", async () => {
    let fetchCount = 0;
    const captured = await captureOpenAPISpec({
      environment: "production",
      fetcher: async () => {
        fetchCount += 1;
        throw new Error("must not fetch");
      },
    });

    expect(captured).toBeNull();
    expect(fetchCount).toBe(0);
  });

  test("fails a production build when its configured source is unavailable", async () => {
    const capture = captureOpenAPISpec({
      environment: "production",
      specUrl: "https://deploy.example.com/api/reference/spec.json",
      fetcher: async () => new Response("unavailable", { status: 503 }),
    });

    expect(await rejectionOf(capture)).toThrow("request failed with 503");
  });

  test("reports and omits an unavailable development snapshot", async () => {
    let reported: unknown;
    const captured = await captureOpenAPISpec({
      environment: "development",
      fetcher: async () => new Response("unavailable", { status: 503 }),
      onUnavailable: (error) => {
        reported = error;
      },
    });

    expect(captured).toBeNull();
    expect(() => {
      throw reported;
    }).toThrow("request failed with 503");
  });
});
