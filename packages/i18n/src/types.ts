/**
 * The type-level i18n contract.
 *
 * Two guarantees, both enforced by `tsc` rather than by a test that someone
 * has to remember to run:
 *
 *   1. **Keys exist.** `CustomTypeOptions` binds i18next's key union to the
 *      English bundle, so `t("nav.projcts")` is a compile error at the call
 *      site — not a string that renders as its own key in production.
 *   2. **Locales don't drift.** Every English key must have a translation in
 *      every other locale and vice versa. A mismatch fails the build and the
 *      error names the offending key.
 *
 * English is the source of truth for which keys exist; every other locale is
 * checked against it. Adding a locale is two lines: import the bundle and add
 * one `LocaleParity` entry below.
 *
 * IMPORTANT: this module must stay in the compilation for the augmentation to
 * apply — `index.ts` and `web.ts` both import it for that side effect. It has
 * no runtime content, so the import costs nothing at runtime.
 */

import type de from "./locales/de.json";
import type en from "./locales/en.json";
import type es from "./locales/es.json";

/** Shape of a complete translation bundle. */
export type Translation = typeof en;

// ─── i18next augmentation ────────────────────────────────────────────
//
// Augment "i18next", NOT "react-i18next". react-i18next re-exports i18next's
// `CustomTypeOptions`, so augmenting it was correct on v11 and is a silent
// no-op on the version this repo uses — the failure mode being that every key
// typechecks, including the ones that don't exist.

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: Translation };
    /** `init` sets no `returnNull`, so a lookup is `string`, never `null`. */
    returnNull: false;
  }
}

// ─── Locale parity ───────────────────────────────────────────────────

/**
 * i18next resolves `key_one` / `key_other` from a call to plain `key` with a
 * `count`, so plural variants collapse to their base name for comparison
 * purposes — otherwise a language with a different plural rule set could never
 * be at parity with English.
 */
type PluralSuffix = "_zero" | "_one" | "_two" | "_few" | "_many" | "_other";

type BaseKey<K extends string> = K extends `${infer Base}${PluralSuffix}` ? Base : K;

/** Every leaf of a bundle as a dotted path, plural suffixes folded away. */
type Paths<T> = {
  [K in keyof T & string]: T[K] extends string ? BaseKey<K> : `${K}.${Paths<T[K]>}`;
}[keyof T & string];

/**
 * Compile-time assertion that a key set is empty.
 *
 * When it isn't, the constraint failure prints the offending keys — so the
 * error reads "Type '"nav.projects"' does not satisfy the constraint 'never'"
 * rather than something generic.
 */
type AssertNoKeys<Keys extends never> = Keys;

/**
 * Both directions of drift, per locale.
 *
 * First slot — English defines it, this locale doesn't. That's the failure
 * users actually see: i18next silently serves the English string.
 * Second slot — this locale defines it, English doesn't. Usually a rename
 * that only landed in one file.
 *
 * Deliberately NOT a generic `LocaleParity<Locale>` helper: TypeScript checks
 * `AssertNoKeys`'s `extends never` constraint at the point the generic is
 * *declared*, with the type parameter still unresolved, so the helper fails to
 * compile for every locale including correct ones. Each locale has to
 * instantiate `Paths` concretely.
 *
 * Adding a locale is one entry here plus one in `resources.ts`.
 */
export type GermanParity = [
  AssertNoKeys<Exclude<Paths<Translation>, Paths<typeof de>>>,
  AssertNoKeys<Exclude<Paths<typeof de>, Paths<Translation>>>,
];

export type SpanishParity = [
  AssertNoKeys<Exclude<Paths<Translation>, Paths<typeof es>>>,
  AssertNoKeys<Exclude<Paths<typeof es>, Paths<Translation>>>,
];

/**
 * Every valid translation key, as a literal union.
 *
 * Use it to type a key that travels as data — a nav manifest entry, a tab
 * definition — so the indirection doesn't launder a typo past the checker.
 */
export type TranslationKey = Paths<Translation>;
