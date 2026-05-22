import type { ErrorComponentProps } from "@tanstack/react-router";

import { ErrorScreen, errorBackClass, errorBtnClass } from "./error-screen";

/**
 * 500 screen — wired into the router as `defaultErrorComponent` (see main.tsx).
 * Renders when a route loader or component throws. `reset` retries the boundary.
 */
export function ServerError({ reset }: ErrorComponentProps) {
  return (
    <ErrorScreen
      code="500"
      accent="red"
      eyebrow="Internal error"
      title="Something broke."
      statusTag="FAULT"
      message="OtterStack hit an unexpected error rendering this page. The failure has been logged — this one's on us, not you. Try again in a moment."
      actions={
        <>
          <button
            type="button"
            className={errorBtnClass}
            onClick={() => reset()}
          >
            ⟳ Retry
          </button>
          <a className={errorBackClass} href="/">
            ↩ Return home
          </a>
        </>
      }
    />
  );
}
