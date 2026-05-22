import {
  ErrorScreen,
  errorBackClass,
  errorBtnClass,
  errorPathClass,
} from "./error-screen";

/**
 * 404 screen — wired into the router as `defaultNotFoundComponent` (see main.tsx).
 * Renders for any unmatched route in the OtterStack control panel.
 */
export function NotFound() {
  const path = typeof window !== "undefined" ? window.location.pathname : "";
  const shown = path && path !== "/" ? path : "that path";

  return (
    <ErrorScreen
      code="404"
      accent="indigo"
      eyebrow="Page not found"
      title="Nothing here."
      statusTag="NO_ROUTE"
      message={
        <>
          There's no route to <span className={errorPathClass}>{shown}</span> in
          this app. It may have moved, been renamed, or never existed.
        </>
      }
      actions={
        <>
          <a className={errorBtnClass} href="/">
            ↩ Return home
          </a>
          <button
            type="button"
            className={errorBackClass}
            onClick={() => window.history.back()}
          >
            ← Go back
          </button>
        </>
      }
    />
  );
}
