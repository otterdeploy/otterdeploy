/**
 * With no project set up, Analytics rendered the whole dashboard
 * (five zero tiles, an empty chart, six "No data" cards) under a one-line
 * "isn't set up yet" banner. Neither "no site" nor "no first event" can have
 * data, so the overview now leads with a focused setup state for both.
 */
import { renderToStaticMarkup } from "react-dom/server";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { i18nOptions } from "../../../../../../../packages/i18n/src/config";
import { AnalyticsSetupState, setupStateOf, siteProbe, siteRefetchInterval } from "./setup-nudge";

const storefront = { id: "prj_1", slug: "storefront", name: "Storefront" };
const blog = { id: "prj_2", slug: "blog", name: "Blog" };

describe("setupStateOf", () => {
  it("waits for every probe before saying anything", () => {
    expect(setupStateOf([storefront, blog], [{ site: null }, undefined])).toEqual({
      kind: "pending",
    });
  });

  it("is unset when no project in scope has a site", () => {
    expect(setupStateOf([storefront, blog], [{ site: null }, { site: null }])).toEqual({
      kind: "unset",
      projects: [storefront, blog],
    });
  });

  it("is waiting when sites exist but none has an event", () => {
    expect(
      setupStateOf([storefront, blog], [{ site: null }, { site: { firstEventAt: null } }]),
    ).toEqual({ kind: "waiting", project: blog });
  });

  it("is live as soon as any site has an event", () => {
    expect(
      setupStateOf(
        [storefront, blog],
        [{ site: { firstEventAt: null } }, { site: { firstEventAt: "2026-10-08T04:00:00Z" } }],
      ),
    ).toEqual({ kind: "live" });
  });

  it("does not block an install with no projects at all", () => {
    expect(setupStateOf([], [])).toEqual({ kind: "live" });
  });
});

describe("siteProbe", () => {
  it("re-asks a waiting site until its first event, and never otherwise", () => {
    expect(siteRefetchInterval({ site: { firstEventAt: null } })).toBe(10_000);
    expect(siteRefetchInterval({ site: { firstEventAt: "2026-10-08T04:00:00Z" } })).toBe(false);
    expect(siteRefetchInterval({ site: null })).toBe(false);
    expect(siteRefetchInterval(undefined)).toBe(false);
    const probe = siteProbe("prj_1");
    expect(probe.refetchInterval({ state: { data: { site: { firstEventAt: null } } } })).toBe(
      10_000,
    );
  });

  it("trusts an answer for a minute", () => {
    expect(siteProbe("prj_1").staleTime).toBe(60_000);
  });
});

const i18n = createInstance();
beforeAll(async () => {
  await i18n.init({ ...i18nOptions, lng: "en", initAsync: false });
});

function render(state: Parameters<typeof AnalyticsSetupState>[0]["state"]) {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <I18nextProvider i18n={i18n}>
        <AnalyticsSetupState state={state} onGoSetup={() => {}} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

describe("AnalyticsSetupState", () => {
  it("leads with what is missing and one action, not a dashboard", () => {
    const html = render({ kind: "unset", projects: [storefront] });
    expect(html).toContain("Web analytics isn&#x27;t set up yet");
    expect(html).toContain("Nothing is collected until a site is set up.");
    expect(html).toContain("Set up");
    expect(html).not.toContain("No data in this range");
  });

  it("lists every project when several could be set up", () => {
    const html = render({ kind: "unset", projects: [storefront, blog] });
    expect(html).toContain("Storefront");
    expect(html).toContain("Blog");
    expect(html).toContain("Set up web analytics for Blog");
  });

  it("says it is waiting, and offers the snippet, once a site exists", () => {
    const html = render({ kind: "waiting", project: storefront });
    expect(html).toContain("Waiting for the first pageview");
    expect(html).toContain("The tracker for Storefront is set up.");
    expect(html).toContain("Show snippet");
  });
});
