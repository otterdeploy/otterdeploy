/**
 * Language resolution — which bundle a given browser language tag actually
 * gets.
 *
 * Nearly no German browser reports plain `de` — it sends `de-DE`, `de-AT`,
 * `de-CH`. If those don't land on the German bundle then German exists and
 * effectively nobody sees it, a failure that reads as "translation didn't
 * work" and is invisible to anyone testing with a hand-picked language.
 *
 * They do land, via i18next's fallback chain (`de-DE` → `de` → `en`) stopping
 * at `de` because `de` is in `supportedLngs`. This suite exists to keep that
 * true: it pins the behaviour, not the mechanism, so it survives a config
 * refactor and fails on one that breaks resolution. (Verified non-vacuous —
 * dropping `supportedLngs` while setting `load: "currentOnly"` makes `de-DE`
 * resolve to English and these tests go red.)
 *
 * Asserted against the app's real init options (`i18nOptions`), not a copy.
 */

import { createInstance } from "i18next";
import { beforeAll, describe, expect, it } from "vitest";

import { i18nOptions } from "../../../../../packages/i18n/src/config";

/**
 * A standalone instance so these assertions can't disturb the singleton the
 * app uses. No language detector: the tag is supplied directly, which is what
 * the detector would have produced from `navigator.language`.
 */
const i18n = createInstance();

beforeAll(async () => {
  await i18n.init({ ...i18nOptions, initAsync: false });
});

async function resolve(tag: string): Promise<string | undefined> {
  await i18n.changeLanguage(tag);
  return i18n.resolvedLanguage;
}

describe("regional tags resolve to their base language", () => {
  // The tags real German-speaking browsers actually send.
  it.each(["de", "de-DE", "de-AT", "de-CH", "de-LI", "de-LU"])("%s → de", async (tag) => {
    expect(await resolve(tag)).toBe("de");
  });

  it.each(["es", "es-ES", "es-MX", "es-AR", "es-419"])("%s → es", async (tag) => {
    expect(await resolve(tag)).toBe("es");
  });

  it.each(["en", "en-US", "en-GB", "en-AU"])("%s → en", async (tag) => {
    expect(await resolve(tag)).toBe("en");
  });
});

describe("unsupported languages fall back to English", () => {
  // English is the source of truth for which keys exist, so it's the only
  // sound fallback — a partially-translated locale would be worse.
  it.each(["fr", "fr-FR", "ja", "pt-BR", "zz"])("%s → en", async (tag) => {
    expect(await resolve(tag)).toBe("en");
  });
});

describe("the resolved bundle is genuinely the right one", () => {
  it("serves German strings to a de-DE browser", async () => {
    await i18n.changeLanguage("de-DE");
    expect(i18n.t("auth.signIn.title")).toBe("Anmelden");
    expect(i18n.t("nav.settings")).toBe("Einstellungen");
  });

  it("serves Spanish strings to an es-MX browser", async () => {
    await i18n.changeLanguage("es-MX");
    expect(i18n.t("auth.signIn.title")).toBe("Iniciar sesión");
  });

  it("serves English to a browser we have no bundle for", async () => {
    await i18n.changeLanguage("fr-FR");
    expect(i18n.t("auth.signIn.title")).toBe("Sign in");
  });

  it("pluralises in the resolved language", async () => {
    // German and English share a two-form rule, but the strings differ — this
    // catches a bundle that resolved but whose plural keys didn't.
    await i18n.changeLanguage("de-DE");
    expect(i18n.t("projects.database", { count: 1 })).toBe("Datenbank");
    expect(i18n.t("projects.database", { count: 3 })).toBe("Datenbanken");
  });
});
