/**
 * Container registry RPC contract.
 *
 * Surface:
 *   list   — registries for the active org (no passwords ever leave the
 *            server; only the masked username / host / displayName)
 *   create — add a new credential. Plaintext password is sent over the
 *            wire (TLS-only) and immediately encrypted at rest via
 *            encryptSecret. Returns the new view row.
 *   update — change displayName / username / optional password. Empty
 *            password means "leave existing one in place" so the UI
 *            can offer field-by-field edits without re-prompting.
 *   delete — remove the credential. Projects that point at it lose
 *            their build target; the FK on project.containerRegistryId
 *            is application-managed so the row is set NULL by hand.
 *
 * `host` is normalized server-side to match the resolver's expectations
 * (lowercase; "docker.io" canonicalized).
 */
import { ID_PREFIX, zId } from "@otterdeploy/shared/id";

import { oc } from "@orpc/contract";
import * as z from "zod";

const tag = "registry";
const basePath = "/registries";

export const registryAuthTypeSchema = z.enum(["password", "token"]);

export const containerRegistryViewSchema = z.object({
  id: zId(ID_PREFIX.containerRegistry),
  displayName: z.string(),
  host: z.string(),
  username: z.string(),
  authType: registryAuthTypeSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const listRegistriesInput = z.void();

export const createRegistryInput = z.object({
  displayName: z.string().min(1).max(120),
  host: z.string().min(1).max(255),
  username: z.string().min(1).max(255),
  password: z.string().min(1).max(4096),
  authType: registryAuthTypeSchema.default("password"),
});

export const updateRegistryInput = z.object({
  id: zId(ID_PREFIX.containerRegistry),
  displayName: z.string().min(1).max(120).optional(),
  username: z.string().min(1).max(255).optional(),
  /** Empty string is treated the same as omitted — leave password alone. */
  password: z.string().max(4096).optional(),
  authType: registryAuthTypeSchema.optional(),
});

export const deleteRegistryInput = z.object({
  id: zId(ID_PREFIX.containerRegistry),
});

export const registryContract = {
  list: oc
    .meta({ path: basePath, tag, method: "GET" })
    .input(listRegistriesInput)
    .output(z.array(containerRegistryViewSchema)),
  create: oc
    .errors({
      CONFLICT: {
        status: 409,
        message: "A credential for this host + username already exists" as const,
      },
    })
    .meta({ path: basePath, tag, method: "POST" })
    .input(createRegistryInput)
    .output(containerRegistryViewSchema),
  update: oc
    .errors({
      NOT_FOUND: { status: 404, message: "Registry credential not found" as const },
    })
    .meta({ path: `${basePath}/{id}`, tag, method: "PATCH" })
    .input(updateRegistryInput)
    .output(containerRegistryViewSchema),
  delete: oc
    .errors({
      NOT_FOUND: { status: 404, message: "Registry credential not found" as const },
    })
    .meta({ path: `${basePath}/{id}`, tag, method: "DELETE" })
    .input(deleteRegistryInput)
    .output(z.object({ ok: z.boolean() })),
};
