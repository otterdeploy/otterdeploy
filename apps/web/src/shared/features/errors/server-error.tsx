import type { ErrorComponentProps } from "@tanstack/react-router";

import { ErrorScreen, errorBackClass, errorBtnClass } from "@otterdeploy/ui/error-screen";
import { useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { rateLimitRetryAfter } from "@/shared/server/rate-limited";

import { RateLimited } from "./rate-limited";

/**
 * 500 screen, wired into the router as `defaultErrorComponent` (see main.tsx).
 * Renders when a route loader or component throws. `reset` retries the boundary.
 * A rate limit (429) is not a 500: it renders the RateLimited notice instead.
 */
export function ServerError({ reset, error }: ErrorComponentProps) {
  const { t } = useTranslation();
  const router = useRouter();
  // A 429 is the server asking this client to wait, not a fault: render the
  // calm, self-retrying notice instead of the 500 screen. Its retry re-runs
  // the route's loads (`invalidate`): a failed beforeLoad stays failed until
  // it runs again, and the boundary resets once it has.
  const retryAfterSeconds = rateLimitRetryAfter(error);
  if (retryAfterSeconds !== null) {
    return (
      <RateLimited
        retryAfterSeconds={retryAfterSeconds}
        onRetry={() => {
          void router.invalidate();
        }}
      />
    );
  }
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
