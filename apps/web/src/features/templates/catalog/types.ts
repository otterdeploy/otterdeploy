/**
 * Typed catalog of deployable stack templates.
 *
 * Every entry carries the exact compose YAML the compose wizard stages — no
 * synthetic metadata. The catalog is honesty-gated by catalog.test.ts: each
 * compose must round-trip the repo's own parser (`parseCompose`) with zero
 * warnings, `includes` must equal the parsed service names, and `requiredEnv`
 * must equal the `${VAR}` refs the file actually declares without defaults.
 */

export type TemplateCategoryId =
  | "cms"
  | "analytics"
  | "automation"
  | "observability"
  | "data"
  | "security"
  | "devtools";

export const TEMPLATE_CATEGORIES: { id: TemplateCategoryId; label: string }[] = [
  { id: "cms", label: "CMS" },
  { id: "analytics", label: "Analytics" },
  { id: "automation", label: "Automation" },
  { id: "observability", label: "Observability" },
  { id: "data", label: "Data & storage" },
  { id: "security", label: "Security" },
  { id: "devtools", label: "Dev tools" },
];

export interface TemplateEnvVar {
  /** `${KEY}` ref in the compose file — required (no `:-default`). */
  key: string;
  description: string;
  /** How to produce a good value, e.g. `openssl rand -base64 32`. Shown mono. */
  generateHint?: string;
}

export interface StackTemplate {
  id: string;
  name: string;
  description: string;
  category: TemplateCategoryId;
  /** Compose service names — unit-tested to match the parsed file exactly. */
  includes: string[];
  requiredEnv: TemplateEnvVar[];
  /** SvglLogo search string; renders a monogram tile when no brand mark exists. */
  logoBrand: string;
  docsUrl: string;
  /** The deployable compose file — the exact YAML handed to the compose wizard. */
  compose: string;
}
