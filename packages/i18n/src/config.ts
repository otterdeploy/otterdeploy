/**
 * i18next init options, shared by the browser entry point and the tests that
 * pin its language-resolution behaviour.
 *
 * Extracted from `web.ts` so a test asserts against the options the app
 * actually initialises with. A test that re-declares them proves only that a
 * copy behaves as expected.
 */

import type { InitOptions } from "i18next";

import { resources, supportedLngs } from "./resources";

export const i18nOptions = {
  resources,
  /**
   * English is the only sound fallback: it's the source of truth for which
   * keys exist, so a miss lands on a complete bundle rather than a partial one.
   */
  fallbackLng: "en",
  /**
   * Listing base languages here is what makes regional tags work.
   *
   * Browsers report `de-DE`, `de-AT`, `de-CH`, `es-MX` — nearly nobody sends
   * plain `de`. i18next walks the fallback chain `de-DE` → `de` → `en` and,
   * because `de` is supported, stops there: `resolvedLanguage` is `de` and the
   * German bundle is served. Nothing extra is needed for that — see
   * `language-resolution.test.ts`, which enumerates the tags and would catch a
   * config change that broke the chain (dropping this list while forcing
   * `load: "currentOnly"` is the combination that does).
   *
   * `load: "languageOnly"` is deliberately NOT set. It doesn't affect which
   * bundle is resolved, and it leaves `i18n.language` as the raw `de-DE`
   * instead of the normalised `de` this list produces.
   */
  supportedLngs,
  interpolation: { escapeValue: false },
  detection: {
    order: ["localStorage", "navigator", "htmlTag"],
    caches: ["localStorage"],
    lookupLocalStorage: "lang",
  },
} satisfies InitOptions;
