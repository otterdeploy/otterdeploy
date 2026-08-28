import { createCsrfMiddleware, createStart } from "@tanstack/react-start";

import { trailingSlashMiddleware } from "./trailing-slash";

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => {
  return {
    // Trailing-slash first: it answers with a redirect and never reaches the
    // router, so there is nothing for CSRF to validate on those requests.
    requestMiddleware: [trailingSlashMiddleware, csrfMiddleware],
  };
});
