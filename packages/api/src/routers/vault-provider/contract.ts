/**
 * External secret-manager oRPC contract — org-scoped provider connections
 * whose secrets are referenced from env vars as
 * `${{vault.<providerName>.<ref>}}` and resolved only at deploy time.
 *
 * The stored credential is NEVER part of any output schema — the list view
 * carries `credentialSet: boolean` and nothing else. Reads are open to any
 * org member (the reference picker needs the names); mutations are gated
 * admin/owner in the router.
 */
import { oc } from "@orpc/contract";
import { zId } from "@otterdeploy/shared/id";
import * as z from "zod";

const tag = "vault-provider";
const basePath = "/vault-providers";

export const vaultProviderKindSchema = z.enum(["hashicorp", "infisical", "doppler"]);

/** The `<providerName>` segment of a reference token — must survive the
 *  parser grammar, hence the lowercase-slug shape. */
export const vaultProviderNameSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, "lowercase letters, digits, `-`/`_`, max 64 chars");

const providerIdField = zId("vlt");

// Per-kind NON-SECRET config. The credential (Vault token / Infisical client
// secret / Doppler service token) always travels separately so it can be
// encrypted on arrival and omitted on update.
const hashicorpConfigSchema = z.object({
  /** Vault/OpenBao base URL, e.g. https://vault.example.com:8200 */
  url: z.string().trim().url().max(2048),
  /** KV v2 mount path. */
  mount: z.string().trim().min(1).max(256).default("secret"),
  /** Enterprise/HCP namespace (X-Vault-Namespace). */
  namespace: z.string().trim().max(256).optional(),
});

const infisicalConfigSchema = z.object({
  /** Blank ⇒ Infisical Cloud. Any other value is a self-hosted instance. */
  siteUrl: z.string().trim().url().max(2048).optional(),
  /** Universal Auth machine-identity client ID (the non-secret half). */
  clientId: z.string().trim().min(1).max(512),
  projectId: z.string().trim().min(1).max(512),
  environmentSlug: z.string().trim().min(1).max(256),
  secretPath: z.string().trim().max(1024).optional(),
});

const dopplerConfigSchema = z.object({
  /** Only needed when the service token isn't pre-scoped to one config. */
  dopplerProject: z.string().trim().max(256).optional(),
  dopplerConfig: z.string().trim().max(256).optional(),
});

const createInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("hashicorp"),
    name: vaultProviderNameSchema,
    config: hashicorpConfigSchema,
    /** Vault token. */
    credential: z.string().min(1).max(8192),
  }),
  z.object({
    kind: z.literal("infisical"),
    name: vaultProviderNameSchema,
    config: infisicalConfigSchema,
    /** Universal Auth client secret. */
    credential: z.string().min(1).max(8192),
  }),
  z.object({
    kind: z.literal("doppler"),
    name: vaultProviderNameSchema,
    config: dopplerConfigSchema,
    /** Doppler service token. */
    credential: z.string().min(1).max(8192),
  }),
]);

// Update mirrors create per kind (the kind itself is immutable — delete and
// recreate to change it) but every field is optional; an absent credential
// means "keep the stored one".
const updateInput = z.object({
  id: providerIdField,
  name: vaultProviderNameSchema.optional(),
  config: z.union([hashicorpConfigSchema, infisicalConfigSchema, dopplerConfigSchema]).optional(),
  credential: z.string().min(1).max(8192).optional(),
});

const providerView = z.object({
  id: providerIdField,
  name: z.string(),
  kind: vaultProviderKindSchema,
  /** Non-secret config only — never the credential. */
  config: z.object({
    url: z.string().optional(),
    mount: z.string().optional(),
    namespace: z.string().optional(),
    siteUrl: z.string().optional(),
    clientId: z.string().optional(),
    projectId: z.string().optional(),
    environmentSlug: z.string().optional(),
    secretPath: z.string().optional(),
    dopplerProject: z.string().optional(),
    dopplerConfig: z.string().optional(),
  }),
  /** True when a credential is stored (it is never returned). */
  credentialSet: z.boolean(),
  status: z.enum(["unverified", "connected", "error"]),
  lastVerifiedAt: z.date().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

const byIdInput = z.object({ id: providerIdField });

const providerErrors = {
  NOT_FOUND: { status: 404, message: "Secret provider not found" as const },
  NAME_TAKEN: {
    status: 409,
    message: "A secret provider with that name already exists" as const,
  },
} as const;

export const vaultProviderContract = {
  list: oc
    .route({ method: "GET", path: basePath, tags: [tag] })
    .input(z.object({}).optional())
    .output(z.array(providerView)),

  create: oc
    .errors(providerErrors)
    .route({ method: "POST", path: basePath, tags: [tag] })
    .input(createInput)
    .output(providerView),

  update: oc
    .errors(providerErrors)
    .route({ method: "PATCH", path: `${basePath}/{id}`, tags: [tag] })
    .input(updateInput)
    .output(providerView),

  remove: oc
    .errors(providerErrors)
    .route({ method: "DELETE", path: `${basePath}/{id}`, tags: [tag] })
    .input(byIdInput)
    .output(z.object({ ok: z.literal(true) })),

  /** Round-trip the stored credential and record the outcome on the row. */
  test: oc
    .errors(providerErrors)
    .route({ method: "POST", path: `${basePath}/{id}/test`, tags: [tag] })
    .input(byIdInput)
    .output(z.object({ ok: z.boolean(), error: z.string().nullable() })),

  /** Best-effort key listing for the reference picker — `[]` on any provider
   *  failure, never an error (the picker degrades to free-text refs). */
  listSecretNames: oc
    .errors(providerErrors)
    .route({ method: "GET", path: `${basePath}/{id}/secret-names`, tags: [tag] })
    .input(byIdInput)
    .output(z.array(z.string())),
};
