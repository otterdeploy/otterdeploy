import type { ErrorComponentProps } from "@tanstack/react-router";

import { ErrorScreen, errorBackClass, errorBtnClass } from "@otterdeploy/ui/error-screen";

/**
 * 500 — wired into the router as `defaultErrorComponent` (see router.tsx).
 *
 * Without this the app fell back to TanStack Start's unstyled boundary: a bare
 * "Something went wrong!" heading and a *Show Error* button on a white page,
 * which is what visitors saw when an SSR route threw. `reset` retries the
 * boundary.
 */
export function ServerError({ reset, error }: ErrorComponentProps) {
  return (
    <ErrorScreen
      code="500"
      accent="red"
      eyebrow="Server error"
      title="That page didn't render"
      statusTag="RENDER_FAILED"
      message={error?.message ?? "Something failed on our side while building this page."}
      actions={
        <>
          <button type="button" className={errorBtnClass} onClick={() => reset()}>
            Try again
          </button>
          <a className={errorBackClass} href="/">
            Back home
          </a>
        </>
      }
    />
  );
}
