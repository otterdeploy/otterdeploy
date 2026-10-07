/**
 * API keys oRPC contract. Only `create` lives server-side: the better-auth
 * apiKey plugin rejects the `permissions` field on browser (client) requests
 * (`SERVER_ONLY_PROPERTY`), so minting a scoped key must go through the server
 * auth instance. List / delete / enable-toggle stay on the browser apiKey
 * client (no server-only fields involved).
 */
import { oc } from "@orpc/contract";
import * as z from "zod";

const tag = "apiKeys";
const basePath = "/api-keys";

/** The deliberate "this key may do everything a member may" choice. */
export const FULL_ACCESS = "full";

/**
 * A limited key's grant: `{ resource: actions[] }` with at least one resource,
 * each with at least one action. An empty map is refused rather than read as
 * anything (it used to mint a full-access key, so the safest-looking form state
 * made the most powerful key).
 */
const limitedPermissionsSchema = z
  .record(z.string(), z.array(z.string()).min(1, "Choose at least one action for each resource."))
  .refine((permissions) => Object.keys(permissions).length > 0, {
    message: `Choose at least one permission, or "${FULL_ACCESS}" for a full-access key.`,
  });

const createApiKeyInput = z.object({
  name: z.string().min(1).max(64),
  /** Seconds until expiry, or null for a key that never expires. */
  expiresIn: z.number().int().positive().nullable(),
  /**
   * What the key may do, stated explicitly: `"full"` (everything the member
   * role may do, the cap every key is held to) or a non-empty
   * `{ resource: actions[] }` map. Required: there is no default, so full
   * access is never what an omitted or empty field means.
   */
  permissions: z.union([z.literal(FULL_ACCESS), limitedPermissionsSchema]),
  /**
   * Optional access-level preset. `"read"` blocks every non-read action
   * regardless of the key's permission map; `"write"` (the default) imposes no
   * extra restriction. Stored in key metadata; enforced by the oRPC permission
   * middleware. Additive: omit for the current full behavior.
   */
  accessLevel: z.enum(["read", "write"]).optional(),
  /**
   * Optional project scoping. `"selected"` restricts the key to `projectIds`;
   * `"all"` (the default) leaves it unrestricted. Stored in key metadata;
   * enforced on project-scoped procedures (incremental adoption).
   */
  projectScope: z.enum(["all", "selected"]).optional(),
  projectIds: z.array(z.string()).optional(),
});

/** The created key. The only time the plaintext `key` is ever returned. */
const createdApiKeySchema = z.object({
  id: z.string(),
  /** Full plaintext token. Shown once, never persisted in readable form. */
  key: z.string(),
  name: z.string().nullable(),
  start: z.string().nullable(),
  prefix: z.string().nullable(),
  enabled: z.boolean(),
  expiresAt: z.date().nullable(),
  createdAt: z.date(),
  /** The key's permission map; null = full access (see `permissions` above,
   *  and every key minted before the explicit choice existed). */
  permissions: z.record(z.string(), z.array(z.string())).nullable(),
});

export const apiKeysContract = {
  create: oc
    .route({ method: "POST", path: basePath, tags: [tag] })
    .errors({
      PERMISSION_NOT_GRANTABLE: {
        status: 400,
        message: "A key cannot hold that permission.",
        data: z.object({ refused: z.array(z.string()) }),
      },
    })
    .input(createApiKeyInput)
    .output(createdApiKeySchema),
};
