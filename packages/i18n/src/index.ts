// Side-effect import: registers the `CustomTypeOptions` augmentation that
// makes translation keys a checked literal union. Without it every key
// typechecks, including the ones that don't exist.
import "./types";

export { resources, supportedLngs, languageNames } from "./resources";
export type { Translation, TranslationKey } from "./types";
