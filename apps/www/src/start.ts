import { createCsrfMiddleware, createStart } from "@tanstack/react-start";

import { canonicalUrlMiddleware } from "./canonical-url";

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => {
  return {
    // Canonical URL first: it answers with a redirect and never reaches the
    // router, so there is nothing for CSRF to validate on those requests.
    requestMiddleware: [canonicalUrlMiddleware, csrfMiddleware],
  };
});
