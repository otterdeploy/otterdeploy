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
  | "analytics"
  | "ai"
  | "automation"
  | "observability"
  | "data"
  | "security"
  | "devtools";

export const TEMPLATE_CATEGORIES: { id: TemplateCategoryId; label: string }[] = [
  { id: "cms", label: "CMS" },
  { id: "crm", label: "CRM" },
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
