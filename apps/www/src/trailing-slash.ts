/**
 * Redirect `/path/` to `/path` with a 301, before the router sees it.
 *
 * TanStack Router already normalises trailing slashes, but it answers with a
 * **307**. 307 is a *temporary* redirect: it tells a crawler "this URL is
 * fine, just use the other one for now", so both spellings stay in the index
 * competing for the same content, and no link equity consolidates onto the
 * canonical form. `/docs/` and `/docs` were being served that way. A 301 says
 * the move is permanent, which is the only version search engines treat as a
 * consolidation instruction.
 *
 * It has to run as REQUEST middleware rather than inside a route, because by
 * the time a route matches, the router has already decided how to answer. This
 * sits in front of `handlerType: "router"` requests and returns the redirect
 * itself.
 *
 * Deliberately narrow:
 *
 *   - `/` is left alone. The site root is legitimately a single slash, and
 *     redirecting it to the empty string is a loop.
 *   - Server-function calls (`handlerType === "serverFn"`) are skipped. They
 *     are RPC, not pages; nothing crawls them, and a redirect mid-call would
 *     break the caller.
 *   - The query string and hash are preserved. Dropping `?q=` on a redirect
 *     silently loses a search, and it is the kind of bug nobody reports.
 */
import { createMiddleware } from "@tanstack/react-start";

export const trailingSlashMiddleware = createMiddleware({ type: "request" }).server(
  ({ request, pathname, handlerType, next }) => {
    if (handlerType === "serverFn") return next();
    if (pathname === "/" || !pathname.endsWith("/")) return next();

    const url = new URL(request.url);
    // Collapse any run of trailing slashes, not just one: `/docs///` should
    // land on `/docs` in a single hop rather than redirecting repeatedly.
    url.pathname = pathname.replace(/\/+$/, "");
    if (url.pathname === "") url.pathname = "/";

    return Response.redirect(url, 301);
  },
);
