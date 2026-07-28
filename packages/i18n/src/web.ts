import "./types";
import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import { i18nOptions } from "./config";

void i18n.use(LanguageDetector).use(initReactI18next).init(i18nOptions);

/**
 * Keep `<html lang>` in step with the active language.
 *
 * The attribute is what screen readers switch pronunciation on and what the
 * browser hyphenates by; leaving it at `en` while the page renders German is
 * a WCAG 3.1.1 failure that's invisible until someone listens to it.
 */
function syncDocumentLang(lng: string): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = lng.split("-")[0] ?? lng;
}

syncDocumentLang(i18n.resolvedLanguage ?? i18n.language ?? "en");
i18n.on("languageChanged", syncDocumentLang);

export { i18n };
export default i18n;
