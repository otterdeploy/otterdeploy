import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";

export const resources = {
  en: { translation: en },
  de: { translation: de },
  es: { translation: es },
} as const;

export const supportedLngs = Object.keys(resources) as Array<keyof typeof resources>;

/**
 * Endonyms: each language named in itself, which is what a language switcher
 * should show: someone looking for German is looking for "Deutsch".
 */
export const languageNames: Record<(typeof supportedLngs)[number], string> = {
  en: "English",
  de: "Deutsch",
  es: "Español",
};
