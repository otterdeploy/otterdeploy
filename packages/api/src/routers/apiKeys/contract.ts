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

const createApiKeyInput = z.object({
  name: z.string().min(1).max(64),
  /** Seconds until expiry, or null for a key that never expires. */
  expiresIn: z.number().int().positive().nullable(),
  /** { resource: actions[] }; omit/empty mints a full-access key. */
  permissions: z.record(z.string(), z.array(z.string())).optional(),
  /**
   * Optional access-level preset. `"read"` blocks every non-read action
   * regardless of the key's permission map; `"write"` (the default) imposes no
   * extra restriction. Stored in key metadata; enforced by the oRPC permission
   * middleware. Additive — omit for the current full behavior.
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

/** The created key — the only time the plaintext `key` is ever returned. */
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
  permissions: z.record(z.string(), z.array(z.string())).nullable(),
});

export const apiKeysContract = {
  create: oc
    .route({ method: "POST", path: basePath, tags: [tag] })
    .input(createApiKeyInput)
    .output(createdApiKeySchema),
};
