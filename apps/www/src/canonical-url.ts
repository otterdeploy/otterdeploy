/**
 * One permanent redirect to the canonical URL: https, apex, lower-case paths,
 * no duplicate or trailing slashes, and no legacy `/next` landing path.
 *
 * Three separate defects, all the same shape, and all previously answered
 * wrongly or not at all:
 *
 *   - `http://otterdeploy.com` returned **200**. The site was reachable over
 *     plain HTTP, which is both an SEO duplicate and a downgrade a visitor
 *     never asked for.
 *   - `https://www.otterdeploy.com` returned **200**. The canonical tag points
 *     at the apex, so search engines mostly cope, but "mostly cope" is not the
 *     same as one address — and wrangler.jsonc has carried a note about this
 *     301 being pending since the site launched.
 *   - `/docs/` returned **307**. A temporary redirect tells a crawler both
 *     spellings are live, so neither consolidates.
 *
 * App-rendered routes are fixed here so the behavior is versioned and travels
 * with the code. Cloudflare serves known static assets before this middleware,
 * so zone-level HTTPS and www→apex rules are still required to cover those
 * asset URLs; that owner-managed edge rule complements this one.
 *
 * ONE redirect, not three. Normalising scheme, host and path in a single pass
 * means `http://www.otterdeploy.com/docs/` reaches its destination in one hop
 * instead of chaining through three, each of which bleeds a little authority
 * and adds a round trip. The same pass folds the old `/next` landing path into
 * `/`, so old links do not canonicalise once and redirect a second time.
 */
import { createMiddleware } from "@tanstack/react-start";

import { canonicalRedirectFor } from "./canonical-url-policy";
import { shouldNoIndexPreview } from "./lib/shared";
import { withPreviewNoIndex, withSiteSecurityHeaders } from "./response-policy";

export const canonicalUrlMiddleware = createMiddleware({ type: "request" }).server(
  async ({ request, pathname, handlerType, next }) => {
    const redirect = canonicalRedirectFor(request, pathname, handlerType);
    if (redirect !== null) {
      return withSiteSecurityHeaders(request, Response.redirect(redirect.url, redirect.status));
    }

    // Server functions are RPC, not pages. Apart from the method-preserving
    // HTTPS upgrade above, leave their host and path untouched.
    if (handlerType === "serverFn") {
      const result = await next();
      const response = withSiteSecurityHeaders(request, result.response);
      return response === result.response ? result : { ...result, response };
    }

    const result = await next();
    let response = result.response;
    if (shouldNoIndexPreview(request.url, handlerType, response.headers.get("content-type"))) {
      response = withPreviewNoIndex(response);
    }
    response = withSiteSecurityHeaders(request, response);
    return response === result.response ? result : { ...result, response };
  },
);
