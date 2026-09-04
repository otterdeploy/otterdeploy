import handler, { createServerEntry } from "@tanstack/react-start/server-entry";

import { handleHtmlNegotiation } from "./accept-negotiation";

/**
 * Keep HTTP content negotiation outside Start's current HTML-only predicate.
 * The wrapper sees the original request both before and after Start, while the
 * application-level middleware remains responsible for redirects, indexing,
 * and security headers.
 */
export default createServerEntry({
  fetch(request, options) {
    return handleHtmlNegotiation(request, (compatibleRequest) =>
      handler.fetch(compatibleRequest, options),
    );
  },
});
