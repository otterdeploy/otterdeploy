/**
 * Shared types + catalog for the org-scoped API keys feature.
 *
 * Keys are owned by the active organization (the better-auth `apiKey` plugin is
 * configured with `references: "organization"` in packages/auth). The plaintext
 * token is returned exactly once from `create`; everywhere else we only ever see
 * the masked `start` prefix.
 */

/**
 * Permission scopes a limited key can be granted. Resources and actions are
 * the org RBAC statements themselves (packages/auth/src/permissions.ts), so
 * what an operator ticks is exactly what authorization checks: the server
 * refuses any `resource:action` a key could never use (every key is capped at
 * the member role). Full access is a separate, explicit choice in the create
 * dialog; an empty selection is never full access.
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
    description: "View and manage projects",
    actions: ["read", "create", "update", "delete"],
  },
  {
    resource: "service",
    label: "Services",
    description: "View, change and deploy services",
    actions: ["read", "deploy", "create", "update", "delete"],
  },
  {
    resource: "database",
    label: "Databases",
    description: "View, query and manage databases",
    actions: ["read", "query", "create", "update", "delete"],
  },
  {
    resource: "env",
    label: "Environments",
    description: "Environments and their variables",
    actions: ["read", "create", "update", "delete"],
  },
  {
    resource: "backup",
    label: "Backups",
    description: "View, run and restore backups",
    actions: ["read", "run", "restore"],
  },
  {
    resource: "route",
    label: "Routes",
    description: "Domains and proxy routes",
    actions: ["read", "create", "update", "delete"],
  },
];

/** The two answers to "what may this key do?". There is no third: a key is
 *  either limited to chosen permissions or deliberately given full access. */
export type KeyAccess = "limited" | "full";

export function isKeyAccess(value: unknown): value is KeyAccess {
  return value === "limited" || value === "full";
}

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
export function formatDate(value: string | Date | null | undefined, fallback = "–"): string {
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
