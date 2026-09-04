const LOCAL_SPEC_URL = "http://localhost:3000/api/reference/spec.json";
const OPENAPI_HANDLER_PREFIX = "/api/reference";
const HTTP_OPERATION_KEYS = new Set([
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
]);

const OPENAPI_SPEC_TIMEOUT_MS = 5_000;

// This is the validated source shape, before Fumadocs upgrades older OpenAPI
// versions to its internal 3.2 representation. Keep the source type honest:
// an accepted 3.0/3.1 document must not be mislabeled as OpenAPI 3.2 merely to
// satisfy Fumadocs' narrower public input declaration.
export interface LoadedOpenAPIDocument extends Record<string, unknown> {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, unknown>;
  servers?: Array<{ url: string }>;
}

type SpecFetch = (url: string, init: RequestInit) => Promise<Response>;

interface LoadOpenAPISpecOptions {
  environment?: string;
  fetcher?: SpecFetch;
  specUrl?: string;
  timeoutMs?: number;
}

interface CaptureOpenAPISpecOptions extends LoadOpenAPISpecOptions {
  environment: "development" | "production";
  onUnavailable?: (error: unknown) => void;
}

export class OpenAPISpecError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OpenAPISpecError";
  }
}

/** Prefer the current brand name while keeping existing deployments working. */
export function resolveConfiguredOpenAPISpecUrl(
  current: string | undefined,
  legacy: string | undefined,
): string | undefined {
  return current?.trim() || legacy?.trim() || undefined;
}

interface OpenAPISpecEnvironment {
  OTTERDEPLOY_OPENAPI_SPEC_URL?: string;
  OTTERSTACK_OPENAPI_SPEC_URL?: string;
}

/** Resolve only the two supported keys, with exported/CI values first. */
export function resolveOpenAPISpecEnvironment(
  primary: OpenAPISpecEnvironment,
  fallback: OpenAPISpecEnvironment,
): string | undefined {
  return (
    resolveConfiguredOpenAPISpecUrl(
      primary.OTTERDEPLOY_OPENAPI_SPEC_URL,
      primary.OTTERSTACK_OPENAPI_SPEC_URL,
    ) ??
    resolveConfiguredOpenAPISpecUrl(
      fallback.OTTERDEPLOY_OPENAPI_SPEC_URL,
      fallback.OTTERSTACK_OPENAPI_SPEC_URL,
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOpenAPIDocument(value: unknown): value is LoadedOpenAPIDocument {
  if (!isRecord(value) || typeof value.openapi !== "string") return false;
  if (!/^3\.[012]\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value.openapi)) return false;
  if (!isRecord(value.info)) return false;
  if (typeof value.info.title !== "string" || value.info.title.trim().length === 0) return false;
  if (typeof value.info.version !== "string" || value.info.version.trim().length === 0) {
    return false;
  }
  return isRecord(value.paths);
}

function hasOperations(paths: Record<string, unknown>): boolean {
  return Object.values(paths).some(
    (pathItem) =>
      isRecord(pathItem) &&
      Object.entries(pathItem).some(
        ([key, operation]) => HTTP_OPERATION_KEYS.has(key) && isRecord(operation),
      ),
  );
}

// Fumadocs bundles the document after this function returns. Its JSON Schema
// ref parser follows remote and file references without this fetch's timeout,
// which would let a compromised source turn docs generation into an untimed
// network/filesystem read. The oRPC document is self-contained, so only local
// JSON Pointer references are valid for this integration.
function hasExternalReferences(value: unknown): boolean {
  const pending: unknown[] = [value];
  const seen = new WeakSet<object>();

  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current !== "object" || current === null || seen.has(current)) continue;
    seen.add(current);

    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }

    if (!isRecord(current)) continue;
    if (typeof current.$ref === "string" && !current.$ref.startsWith("#")) return true;
    pending.push(...Object.values(current));
  }

  return false;
}

function withConfiguredServer(
  document: LoadedOpenAPIDocument,
  specUrl: string,
): LoadedOpenAPIDocument {
  // The control plane is normally behind a TLS-terminating Caddy proxy. Bun
  // constructs Request.url from the HTTP upstream hop and does not fold
  // X-Forwarded-Proto into it, so oRPC can legitimately emit an http server
  // URL for an externally-https request. The configured specification URL is
  // the operator's explicit public address; pin examples to that origin and
  // this project's fixed OpenAPI handler prefix.
  const publicOrigin = new URL(specUrl).origin;
  return {
    ...document,
    servers: [{ url: new URL(OPENAPI_HANDLER_PREFIX, publicOrigin).toString() }],
  };
}

export function resolveOpenAPISpecUrl(specUrl: string | undefined, environment: string): string {
  const configured = specUrl?.trim();
  if (!configured && environment === "production") {
    throw new OpenAPISpecError(
      "OTTERDEPLOY_OPENAPI_SPEC_URL is required to publish API operation pages in production",
    );
  }

  const candidate = configured || LOCAL_SPEC_URL;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch (cause) {
    throw new OpenAPISpecError("OTTERDEPLOY_OPENAPI_SPEC_URL must be an absolute URL", { cause });
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new OpenAPISpecError("OTTERDEPLOY_OPENAPI_SPEC_URL must use HTTP or HTTPS");
  }

  const loopback =
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "[::1]";
  if (environment === "production" && parsed.protocol !== "https:" && !loopback) {
    throw new OpenAPISpecError(
      "OTTERDEPLOY_OPENAPI_SPEC_URL must use HTTPS in production unless it targets loopback",
    );
  }

  return parsed.toString();
}

export async function loadOpenAPISpec({
  environment = "development",
  fetcher = (url, init) => fetch(url, init),
  specUrl,
  timeoutMs = OPENAPI_SPEC_TIMEOUT_MS,
}: LoadOpenAPISpecOptions = {}): Promise<LoadedOpenAPIDocument> {
  const resolvedUrl = resolveOpenAPISpecUrl(specUrl, environment);
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetcher(resolvedUrl, {
      headers: { accept: "application/json" },
      // Require the configured endpoint to be the endpoint we read. Besides
      // keeping the generated server/example origin predictable, this stops a
      // compromised public source from redirecting the build fetch into a
      // private network location.
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      const status = `${response.status} ${response.statusText}`.trim();
      throw new OpenAPISpecError(`OpenAPI specification request failed with ${status}`);
    }

    const value: unknown = await response.json();
    if (!isOpenAPIDocument(value)) {
      throw new OpenAPISpecError(
        "OpenAPI specification response is not a supported OpenAPI 3.0-3.2 document",
      );
    }
    if (!hasOperations(value.paths)) {
      throw new OpenAPISpecError(
        "OpenAPI specification contains no operations; refusing to publish an empty reference",
      );
    }
    if (hasExternalReferences(value)) {
      throw new OpenAPISpecError(
        "OpenAPI specification must be self-contained; external references are not allowed",
      );
    }

    return withConfiguredServer(value, resolvedUrl);
  } catch (cause) {
    if (cause instanceof OpenAPISpecError) throw cause;
    if (timedOut) {
      throw new OpenAPISpecError(`OpenAPI specification request timed out after ${timeoutMs}ms`, {
        cause,
      });
    }
    throw new OpenAPISpecError("OpenAPI specification could not be loaded", { cause });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Capture the docs snapshot with deployment-safe failure semantics.
 *
 * An absent production URL intentionally builds the authored overview only.
 * Once an operator configures a URL, a production failure must stop the build
 * instead of replacing already-indexed operation pages with 404s. Development
 * remains best-effort so the rest of the site can run without a local server.
 */
export async function captureOpenAPISpec({
  environment,
  onUnavailable,
  specUrl,
  ...options
}: CaptureOpenAPISpecOptions): Promise<LoadedOpenAPIDocument | null> {
  if (environment === "production" && !specUrl?.trim()) return null;

  try {
    return await loadOpenAPISpec({ ...options, environment, specUrl });
  } catch (error) {
    if (environment === "production") throw error;
    onUnavailable?.(error);
    return null;
  }
}
