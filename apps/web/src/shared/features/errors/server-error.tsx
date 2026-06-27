import type { ErrorComponentProps } from "@tanstack/react-router";

import { useTranslation } from "react-i18next";

import { ErrorScreen, errorBackClass, errorBtnClass } from "./error-screen";

/**
 * 500 screen — wired into the router as `defaultErrorComponent` (see main.tsx).
 * Renders when a route loader or component throws. `reset` retries the boundary.
 */
export function ServerError({ reset, error }: ErrorComponentProps) {
  const { t } = useTranslation();
  return (
    <ErrorScreen
      code="500"
      accent="red"
      eyebrow={t("errors.serverError.eyebrow")}
      title={t("errors.serverError.title")}
      statusTag={t("errors.serverError.statusTag")}
      message={error?.message ?? t("errors.serverError.messageDefault")}
      actions={
        <>
          <button type="button" className={errorBtnClass} onClick={() => reset()}>
            {t("errors.serverError.retry")}
          </button>
          <a className={errorBackClass} href="/">
            {t("errors.serverError.returnHome")}
          </a>
        </>
      }
    />
  );
}
