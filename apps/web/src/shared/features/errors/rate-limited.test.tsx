/**
 * A 429 renders the calm "slow down" notice, in the product's own copy, never
 * the 500 screen's words. Rendered against the REAL English bundle (see
 * analytics/components/collection-notice.test.tsx for why).
 */

import { renderToStaticMarkup } from "react-dom/server";

import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { i18nOptions } from "../../../../../../packages/i18n/src/config";
import { RateLimited } from "./rate-limited";

const i18n = createInstance();

beforeAll(async () => {
  await i18n.init({ ...i18nOptions, lng: "en", initAsync: false });
});

function render(retryAfterSeconds: number) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <RateLimited retryAfterSeconds={retryAfterSeconds} onRetry={() => {}} />
    </I18nextProvider>,
  );
}

describe("RateLimited", () => {
  it("says to slow down, that the session is fine, and when it retries", () => {
    const out = render(12);
    expect(out).toContain("Slowing down for a moment");
    expect(out).toContain("Your session is fine");
    expect(out).toContain("Retrying in 12 seconds");
    expect(out).toContain("Retry now");
  });

  it("is not the 500 screen", () => {
    const out = render(1);
    expect(out).toContain("Retrying in 1 second");
    for (const loud of ["500", "Internal error", "FAULT", "Something Went Wrong"])
      expect(out).not.toContain(loud);
  });
});
