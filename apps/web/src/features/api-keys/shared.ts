/**
 * Shared types + catalog for the org-scoped API keys feature.
 *
 * Keys are owned by the active organization (the better-auth `apiKey` plugin is
 * configured with `references: "organization"` in packages/auth). The plaintext
 * token is returned exactly once from `create`; everywhere else we only ever see
 * the masked `start` prefix.
 */

/**
 * Permission scopes a key can be granted. Mirrors the org RBAC resources
 * (packages/auth/src/permissions.ts). An empty selection means "full access"
 * (better-auth stores no permission restrictions). Enforcement of these scopes
 * on incoming key-authenticated requests is future work — for now they capture
 * the operator's intent and are shown on the key.
 */
export interface ApiScope {
  resource: string;
  label: string;
  description: string;
  actions: string[];
}

export const API_SCOPES: ApiScope[] = [
  {
    resource: "project",
    label: "Projects",
    description: "Create and manage projects",
    actions: ["read", "write"],
  },
  {
    resource: "service",
    label: "Services",
    description: "Manage services and trigger deploys",
    actions: ["read", "deploy"],
  },
  {
    resource: "database",
    label: "Databases",
    description: "Manage and query databases",
    actions: ["read", "query"],
  },
  {
    resource: "env",
    label: "Environment variables",
    description: "Read and update env vars",
    actions: ["read", "write"],
  },
  {
    resource: "logs",
    label: "Logs",
    description: "Read deployment and edge logs",
    actions: ["read"],
  },
];

/** Expiry presets. Value is seconds to pass as `expiresIn`; null = never. */
export interface ExpiryOption {
  label: string;
  seconds: number | null;
}

const DAY = 60 * 60 * 24;

export const EXPIRY_OPTIONS: ExpiryOption[] = [
  { label: "30 days", seconds: DAY * 30 },
  { label: "90 days", seconds: DAY * 90 },
  { label: "1 year", seconds: DAY * 365 },
  { label: "No expiry", seconds: null },
];

/** Default expiry preset index (90 days). */
export const DEFAULT_EXPIRY_INDEX = 1;

/** Format a date-ish value as a short, human date, or a fallback. */
export function formatDate(value: string | Date | null | undefined, fallback = "—"): string {
  if (!value) return fallback;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** True when the key's expiry is in the past. */
export function isExpired(value: string | Date | null | undefined): boolean {
  if (!value) return false;
  const d = value instanceof Date ? value : new Date(value);
  return !Number.isNaN(d.getTime()) && d.getTime() < Date.now();
}
