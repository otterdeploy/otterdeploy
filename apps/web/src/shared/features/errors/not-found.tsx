import { useTranslation } from "react-i18next";

import { ErrorScreen, errorBackClass, errorBtnClass, errorPathClass } from "./error-screen";

/**
 * 404 screen — wired into the router as `defaultNotFoundComponent` (see main.tsx).
 * Renders for any unmatched route in the Otterdeploy control panel.
 */
export function NotFound() {
  const { t } = useTranslation();
  const path = typeof window !== "undefined" ? window.location.pathname : "";
  const shown = path && path !== "/" ? path : t("errors.notFound.messageFallbackPath");

  return (
    <ErrorScreen
      code="404"
      accent="indigo"
      eyebrow={t("errors.notFound.eyebrow")}
      title={t("errors.notFound.title")}
      statusTag={t("errors.notFound.statusTag")}
      message={
        <>
          {t("errors.notFound.messageBefore")}
          <span className={errorPathClass}>{shown}</span>
          {t("errors.notFound.messageAfter")}
        </>
      }
      actions={
        <>
          <a className={errorBtnClass} href="/">
            {t("errors.notFound.returnHome")}
          </a>
          <button type="button" className={errorBackClass} onClick={() => window.history.back()}>
            {t("errors.notFound.goBack")}
          </button>
        </>
      }
    />
  );
}
