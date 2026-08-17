import type { OrganizationId, VaultProviderId } from "@otterdeploy/shared/id";

// External secret managers — org-scoped connections to a secret store whose
// values are referenced from env vars as `${{vault.<providerName>.<ref>}}`.
// Resolution happens at deploy time; the referenced secret value is NEVER
// persisted by otterdeploy — only the provider's own credential is stored
// here, encrypted at rest, exactly like `meshNetwork.apiTokenCiphertext`.
//
// Supported kinds today: HashiCorp Vault / OpenBao (KV v2), Infisical,
// Doppler. AWS Secrets Manager / Azure Key Vault / Scaleway are deliberately
// out of scope for now — the `kind` enum + `configJson` bag are shaped so a
// new provider is one enum value and one client module, no schema rework.
import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization } from "./auth";

export const vaultProviderKindEnum = pgEnum("vault_provider_kind", [
  "hashicorp",
  "infisical",
  "doppler",
]);

// "unverified" = created but never round-tripped; "connected" = the last
// test succeeded; "error" = the last test failed (lastError says why). A
// failing provider keeps its row so the operator can fix the credential
// without re-entering the whole config — same posture as meshNetwork.
export const vaultProviderStatusEnum = pgEnum("vault_provider_status", [
  "unverified",
  "connected",
  "error",
]);

/**
 * Non-secret provider configuration. One flat bag rather than a per-kind
 * union: jsonb can't discriminate anyway, and the contract layer enforces
 * per-kind required fields with zod before anything lands here.
 *
 *   hashicorp : url, mount (default "secret"), namespace?
 *   infisical : siteUrl (default cloud), clientId (non-secret half of
 *               Universal Auth), projectId, environmentSlug, secretPath?
 *   doppler   : dopplerProject?, dopplerConfig? (both optional — a service
 *               token is usually pre-scoped to one config)
 */
export interface VaultProviderConfig {
  url?: string;
  mount?: string;
  namespace?: string;
  siteUrl?: string;
  clientId?: string;
  projectId?: string;
  environmentSlug?: string;
  secretPath?: string;
  dopplerProject?: string;
  dopplerConfig?: string;
}

export const vaultProvider = pgTable(
  "vault_provider",
  {
    id: text("id")
      .primaryKey()
      .$type<VaultProviderId>()
      .$defaultFn(() => createId(ID_PREFIX.vaultProvider)),
    organizationId: text("organization_id")
      .notNull()
      .$type<OrganizationId>()
      .references(() => organization.id, { onDelete: "cascade" }),
    // The `<providerName>` segment of `${{vault.<providerName>.<ref>}}`.
    // Lowercase slug (`^[a-z0-9][a-z0-9_-]{0,63}$`, enforced at the contract)
    // so it always survives the reference grammar.
    name: text("name").notNull(),
    kind: vaultProviderKindEnum("kind").notNull(),
    configJson: jsonb("config_json").$type<VaultProviderConfig>().notNull().default({}),
    // The secret credential — Vault token / Infisical clientSecret / Doppler
    // service token — AES-GCM ciphertext under the "vault-creds" domain
    // (packages/api/src/lib/crypto.ts). Never leaves the server; no output
    // schema ever includes it.
    credentialCiphertext: text("credential_ciphertext").notNull(),
    status: vaultProviderStatusEnum("status").notNull().default("unverified"),
    lastVerifiedAt: timestamp("last_verified_at"),
    // Human-readable reason the last test failed; cleared on success.
    lastError: text("last_error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    // The name is the reference-token namespace, so it must be unique per org.
    uniqueIndex("vault_provider_org_name_unique").on(table.organizationId, table.name),
  ],
);
