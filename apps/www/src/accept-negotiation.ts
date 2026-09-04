import { withResponseHeaders } from "./response-policy";

/**
 * TanStack Start currently answers an unsupported `Accept` header on document
 * routes with a JSON 500. Its pinned predicate is also case-sensitive, does
 * not recognise `text/*`, and ignores q-values. The server entry normalises
 * semantically acceptable HTML requests before the framework and applies the
 * response-side rules here against the original header afterward.
 *
 * Keep the match deliberately strict. The server entry also wraps first-class
 * server routes such as `/sitemap.xml` and `/llms.txt`; matching only on the
 * request header would incorrectly reject those routes before they can return
 * their non-HTML representations.
 */

const TANSTACK_HTML_ONLY_ERROR = "Only HTML requests are supported here";

function htmlSpecificity(mediaRange: string): number {
  if (mediaRange === "text/html") return 3;
  if (mediaRange === "text/*") return 2;
  if (mediaRange === "*/*") return 1;
  return 0;
}

function qualityOf(parameters: string[]): number {
  const qualityParameter = parameters.find((parameter) => {
    const [name] = parameter.split("=", 1);
    return name?.trim().toLowerCase() === "q";
  });
  if (!qualityParameter) return 1;

  const separator = qualityParameter.indexOf("=");
  const quality =
    separator === -1 ? Number.NaN : Number(qualityParameter.slice(separator + 1).trim());
  return Number.isFinite(quality) && quality >= 0 && quality <= 1 ? quality : 0;
}

/** Whether an Accept header gives HTML a non-zero effective quality. The most
 * specific matching media range governs (exact HTML over a text wildcard over
 * the all-types wildcard), so a wildcard cannot override an explicit refusal. */
function htmlQualityOf(accept: string): number {
  let bestSpecificity = 0;
  let quality = 0;

  for (const entry of accept.split(",")) {
    const [mediaRange = "", ...parameters] = entry.split(";");
    const specificity = htmlSpecificity(mediaRange.trim().toLowerCase());
    if (specificity === 0 || specificity < bestSpecificity) continue;

    const candidateQuality = qualityOf(parameters);
    if (specificity > bestSpecificity) {
      bestSpecificity = specificity;
      quality = candidateQuality;
    } else {
      quality = Math.max(quality, candidateQuality);
    }
  }

  return bestSpecificity > 0 ? quality : 0;
}

function acceptsHtml(accept: string): boolean {
  return htmlQualityOf(accept) > 0;
}

/** Match the exact, intentionally isolated predicate in the pinned Start
 * handler. This can go away once the framework implements HTTP negotiation. */
function frameworkRecognisesHtml(accept: string): boolean {
  return ["*/*", "text/html"].some((mimeType) =>
    accept.split(",").some((part) => part.trim().startsWith(mimeType)),
  );
}

/** Give the pinned framework an equivalent lowercase exact range when the
 * original header accepts HTML but its narrow parser would reject it. */
export function frameworkCompatibleHtmlRequest(request: Request): Request {
  const accept = request.headers.get("accept");
  if (accept === null || !acceptsHtml(accept) || frameworkRecognisesHtml(accept)) {
    return request;
  }

  const headers = new Headers(request.headers);
  headers.set("accept", `${accept}, text/html;q=${htmlQualityOf(accept)}`);
  return new Request(request, { headers });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTanStackHtmlOnlyError(body: unknown): boolean {
  return (
    isRecord(body) && Object.keys(body).length === 1 && body.error === TANSTACK_HTML_ONLY_ERROR
  );
}

async function hasTanStackHtmlOnlyError(response: Response): Promise<boolean> {
  const contentType = response.headers.get("content-type")?.toLowerCase();
  if (contentType?.startsWith("application/json") !== true) return false;

  try {
    return isTanStackHtmlOnlyError(await response.clone().json());
  } catch {
    return false;
  }
}

function withAcceptVary(response: Response): Response {
  const vary = response.headers.get("vary");
  if (vary === "*" || vary?.split(",").some((name) => name.trim().toLowerCase() === "accept")) {
    return response;
  }

  return withResponseHeaders(response, [["Vary", vary ? `${vary}, Accept` : "Accept"]]);
}

async function notAcceptable(request: Request, response: Response): Promise<Response> {
  if (response.body !== null) {
    try {
      await response.body.cancel();
    } catch {
      // A runtime may already have locked a streamed body. The replacement is
      // still correct; cancellation is only best-effort cleanup.
    }
  }

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("cache-control", "no-store");
  headers.set("content-type", "text/plain; charset=utf-8");

  const varied = withAcceptVary(
    new Response(
      request.method === "HEAD"
        ? null
        : "Not Acceptable: this document route is available as text/html.\n",
      {
        status: 406,
        statusText: "Not Acceptable",
        headers,
      },
    ),
  );
  return varied;
}

export async function normalizeTanStackHtmlNegotiation(
  request: Request,
  response: Response,
): Promise<Response> {
  const accept = request.headers.get("accept");
  const contentType = response.headers.get("content-type")?.toLowerCase();

  if (contentType?.startsWith("text/html") === true) {
    if (accept !== null && !acceptsHtml(accept)) {
      return notAcceptable(request, response);
    }
    return withAcceptVary(response);
  }

  if (response.status !== 500 || accept === null || acceptsHtml(accept)) return response;
  if (!(await hasTanStackHtmlOnlyError(response))) return response;

  return notAcceptable(request, response);
}

/** Run the Start handler between the request and response halves while keeping
 * the original request available for the standards-compliant post-pass. */
export async function handleHtmlNegotiation(
  request: Request,
  handler: (request: Request) => Response | Promise<Response>,
): Promise<Response> {
  const response = await handler(frameworkCompatibleHtmlRequest(request));
  return normalizeTanStackHtmlNegotiation(request, response);
}
