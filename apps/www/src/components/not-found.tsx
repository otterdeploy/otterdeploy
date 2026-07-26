import {
  ErrorScreen,
  errorBackClass,
  errorBtnClass,
  errorPathClass,
} from "@otterdeploy/ui/error-screen";

/**
 * 404 — wired into the router as `defaultNotFoundComponent` (see router.tsx).
 *
 * Shares `ErrorScreen` with the control panel so a wrong URL looks the same
 * whether you hit it here or in the dashboard. Copy is inline rather than
 * translated: this app ships no i18n runtime, and the panel keeps its
 * react-i18next wrapper.
 *
 * Replaces fumadocs' `DefaultNotFound` in the docs shell, which looked nothing
 * like the rest of the product.
 */
export function NotFound() {
  const path = typeof window === "undefined" ? "" : window.location.pathname;
  const shown = path && path !== "/" ? path : "that page";

  return (
    <ErrorScreen
      code="404"
      accent="indigo"
      eyebrow="Not found"
      title="No route to that page"
      statusTag="NO_MATCH"
      message={
        <>
          Nothing is published at <span className={errorPathClass}>{shown}</span>. It may have
          moved — the docs are the best place to look.
        </>
      }
      actions={
        <>
          <a className={errorBtnClass} href="/docs">
            Read the docs
          </a>
          <a className={errorBackClass} href="/">
            Back home
          </a>
        </>
      }
    />
  );
}
