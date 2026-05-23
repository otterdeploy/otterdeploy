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
