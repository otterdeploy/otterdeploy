import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import es from "./locales/es.json";

export const resources = {
  en: { translation: en },
  es: { translation: es },
} as const;

export const supportedLngs = Object.keys(resources) as Array<
  keyof typeof resources
>;

export const languageNames: Record<(typeof supportedLngs)[number], string> = {
  en: "English",
  es: "Español",
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "en",
    supportedLngs,
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator", "htmlTag"],
      caches: ["localStorage"],
      lookupLocalStorage: "lang",
    },
  });

export default i18n;
