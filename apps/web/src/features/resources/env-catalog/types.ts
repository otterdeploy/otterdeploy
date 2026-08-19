/**
 * Typed catalog of KNOWN environment variables per container image, feeding
 * the key autocomplete in the variables editors. Honesty contract: every
 * entry documents where its vars were verified (`verifiedAgainst`) and only
 * lists variables the image at the version we ship actually reads. The
 * catalog is deliberately incomplete — unknown images simply get no
 * suggestions, never guessed ones.
 */

export interface EnvSuggestion {
  key: string;
  /** One sentence: what the variable does at the version we ship. */
  description: string;
  /** Safe literal to prefill when the row's value is empty. Never a secret. */
  defaultValue?: string;
  /** Picking this marks the row sensitive (credentials, tokens, DSNs). */
  secret?: boolean;
  /** The image refuses to start (or the feature hard-fails) without it. */
  required?: boolean;
}

export interface ImageEnvCatalogEntry {
  /** Image repos this entry covers, registry-qualified but tagless,
   *  lowercase, `docker.io/`+`library/` stripped (see normalizeImageRepo). */
  images: string[];
  /** Where and at what version these vars were verified, for future bumps. */
  verifiedAgainst: string;
  vars: EnvSuggestion[];
}
