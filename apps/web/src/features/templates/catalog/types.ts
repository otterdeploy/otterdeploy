/**
 * Typed catalog of deployable stack templates.
 *
 * Every entry carries the exact compose YAML the compose wizard stages, no
 * synthetic metadata. The catalog is honesty-gated by catalog.test.ts: each
 * compose must round-trip the repo's own parser (`parseCompose`) with zero
 * warnings, `includes` must equal the parsed service names, and `requiredEnv`
 * must equal the `${VAR}` refs the file actually declares without defaults.
 *
 * Operator-facing prose lives in the locale bundles under
 * `templates.catalog.<id>`, referenced here as `TranslationKey`s. Product
 * names, image tags, shell hints and the compose YAML itself stay inline:
 * they read identically in every locale.
 */
import type { TranslationKey } from "@otterdeploy/i18n";

export type TemplateCategoryId =
  | "cms"
  | "crm"
  | "communication"
  | "productivity"
  | "media"
  | "commerce"
  | "lowcode"
  | "design"
  | "analytics"
  | "ai"
  | "automation"
  | "observability"
  | "data"
  | "security"
  | "devtools";

/**
 * Declaration order is the gallery's category-sort order and the order of its
 * filter pills, so it is a product decision, not an alphabetical accident.
 *
 * The relative order of `cms` → `analytics` → `data` is pinned by
 * filter.test.ts: it is the fixture that proves the sort reads this array
 * rather than sorting category ids as strings.
 */
export const TEMPLATE_CATEGORIES: { id: TemplateCategoryId; label: string }[] = [
  { id: "cms", label: "CMS" },
  { id: "crm", label: "CRM" },
  { id: "communication", label: "Communication" },
  { id: "productivity", label: "Productivity" },
  { id: "media", label: "Media & files" },
  { id: "commerce", label: "Commerce" },
  { id: "lowcode", label: "Low-code" },
  { id: "design", label: "Design" },
  { id: "analytics", label: "Analytics" },
  { id: "ai", label: "AI" },
  { id: "automation", label: "Automation" },
  { id: "observability", label: "Observability" },
  { id: "data", label: "Data & storage" },
  { id: "security", label: "Security" },
  { id: "devtools", label: "Dev tools" },
];

export interface TemplateEnvVar {
  /** `${KEY}` ref in the compose file, required (no `:-default`). */
  key: string;
  /** `templates.catalog.<template>.env.<KEY>`. A `TranslationKey`, so a typo
   *  or a key the bundles don't carry is a compile error rather than a row
   *  that renders its own key path at the operator. */
  descriptionKey: TranslationKey;
  /** How to produce a good value, e.g. `openssl rand -base64 32`. Shown mono.
   *  Not translated: it is a shell command, identical in every locale. */
  generateHint?: string;
  /**
   * The wire format the upstream REQUIRES, when it decodes this value rather
   * than just storing it.
   *
   * Set this only where the requirement has been checked at the upstream's
   * source. The wizard's default fill is a 24-byte URL-SAFE unpadded secret,
   * which is right for a password and wrong for anything that runs a real
   * base64 decoder over it: NetBird's `store.encryptionKey` goes through
   * `base64.StdEncoding.DecodeString` and demands exactly 32 decoded bytes
   * (util/crypt/crypt.go), so the default value failed on both the alphabet
   * and the length and crash-looped the server on every boot.
   *
   * `bytes` is the DECODED byte count, matching the `openssl rand -base64 N`
   * in `generateHint`. catalog.test.ts holds the two to each other, so the
   * command an operator is shown always produces what the wizard fills in.
   *
   * A GUESSED format is worse than none — it looks authoritative and is
   * silently wrong — so leaving this unset is the correct default.
   */
  generate?: { encoding: "base64"; bytes: number };
}

export interface StackTemplate {
  id: string;
  /** Product name. NOT translated — "Ghost" is "Ghost" in every locale, and
   *  the gallery is searched by it. */
  name: string;
  /** `templates.catalog.<id>.description`. See TemplateEnvVar.descriptionKey. */
  descriptionKey: TranslationKey;
  category: TemplateCategoryId;
  /** Compose service names: unit-tested to match the parsed file exactly. */
  includes: string[];
  requiredEnv: TemplateEnvVar[];
  /** SvglLogo search string; renders a monogram tile when no brand mark exists. */
  logoBrand: string;
  docsUrl: string;
  /** The deployable compose file: the exact YAML handed to the compose wizard. */
  compose: string;
  /**
   * Supporting files staged alongside the compose file, for upstreams whose
   * configuration is file-shaped rather than env-shaped.
   *
   * `interpolate` is what makes this safe to ship: the file's `${VAR}` refs
   * resolve at materialize time against the stack's variables, so a config
   * holding a per-install secret stays a per-install secret. Without it a
   * template could only ship literal text, and every install that deployed it
   * would share whatever key was written into the catalog.
   *
   * A file whose refs are declared here must have them in `requiredEnv` too —
   * catalog.test.ts checks both directions, so a template cannot ship a config
   * with an unprompted `${VAR}` that would silently render empty.
   */
  files?: Array<{ path: string; content: string; interpolate?: boolean }>;
}
