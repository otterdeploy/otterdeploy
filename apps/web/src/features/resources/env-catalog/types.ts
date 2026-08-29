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
  /** Where to get this value (a provider's developer console, a setup guide). */
  docsUrl?: string;
  /**
   * Shape check for a typed value, from a template's `.env.schema` `@type`.
   * Returns the issue to show under the row, or null when the value is fine
   * — or when it cannot be judged: a `${{…}}` / `${…}` reference resolves at
   * deploy, so its shape is unknowable here and never flagged.
   */
  validate?: (value: string) => EnvIssue | null;
}

/**
 * What the editor shows under a row whose value doesn't fit its schema.
 *
 *   warn:  shown, never blocks. An optional value that looks wrong.
 *   block: Save / deploy refuses until it is fixed. A REQUIRED value that is
 *          empty or malformed — the JWT_SECRET-is-blank class of failure,
 *          caught here instead of as a crash-looping container.
 */
export interface EnvIssue {
  level: "warn" | "block";
  message: string;
}

export interface ImageEnvCatalogEntry {
  /** Image repos this entry covers, registry-qualified but tagless,
   *  lowercase, `docker.io/`+`library/` stripped (see normalizeImageRepo). */
  images: string[];
  /** Where and at what version these vars were verified, for future bumps. */
  verifiedAgainst: string;
  vars: EnvSuggestion[];
}
