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
 *   testConnection — Docker Registry v2 handshake against a stored
 *            credential (by id) or inline host/username/password (for
 *            pre-save "Test & save" in the dialog). Returns an honest
 *            {ok, status, message} rather than throwing — a failed
 *            probe is a result, not an RPC error.
 *   listTags — Docker Registry v2 tag listing for an image reference
 *            (wizard tag browser). Same probe-style honesty contract:
 *            {ok, tags, truncated, message}.
 *
 * `host` is normalized server-side to match the resolver's expectations
 * (lowercase; "docker.io" canonicalized).
 */

import { oc } from "@orpc/contract";
import * as z from "zod";

import { containerRegistryIdField } from "../project/contract/shared";

const tag = "registry";
const basePath = "/registries";

const registryAuthTypeSchema = z.enum(["password", "token"]);

const containerRegistryViewSchema = z.object({
  id: containerRegistryIdField,
  displayName: z.string(),
  host: z.string(),
  username: z.string(),
  authType: registryAuthTypeSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});

// GET input must be object/any/unknown for the OpenAPI generator; optional
// empty object keeps "no input" valid.
const listRegistriesInput = z.object({}).optional();

const createRegistryInput = z.object({
  displayName: z.string().min(1).max(120),
  host: z.string().min(1).max(255),
  username: z.string().min(1).max(255),
  password: z.string().min(1).max(4096),
  authType: registryAuthTypeSchema.default("password"),
});

const updateRegistryInput = z.object({
  id: containerRegistryIdField,
  displayName: z.string().min(1).max(120).optional(),
  username: z.string().min(1).max(255).optional(),
  /** Empty string is treated the same as omitted — leave password alone. */
  password: z.string().max(4096).optional(),
  authType: registryAuthTypeSchema.optional(),
});

const deleteRegistryInput = z.object({
  id: containerRegistryIdField,
});

const testConnectionInput = z
  .object({
    /** Test a stored credential. Inline username/password act as overrides. */
    id: containerRegistryIdField.optional(),
    /** Inline pre-save test — required when no id is given. */
    host: z.string().min(1).max(255).optional(),
    username: z.string().max(255).optional(),
    password: z.string().max(4096).optional(),
  })
  .refine((v) => v.id !== undefined || (v.host !== undefined && v.host.trim().length > 0), {
    message: "Provide a registry id or a host to test",
  });

const testConnectionOutput = z.object({
  ok: z.boolean(),
  /** Last HTTP status seen during the handshake; absent on network-level failures. */
  status: z.number().optional(),
  message: z.string(),
});

const listTagsInput = z.object({
  /** Image reference — "nginx", "acme/api:1.2", "ghcr.io/acme/api". Tag/digest suffixes are ignored. */
  image: z.string().min(1).max(512),
  /** Browse with a stored credential (private repos). Its host must match the
   *  image's registry. Omitted → a stored credential matching the image's host
   *  is used when one exists (mirrors deploy-time auth), else anonymous. */
  registryId: containerRegistryIdField.optional(),
});

const tagInfoSchema = z.object({
  name: z.string(),
  /** Content digest (`sha256:…`) when the manifest lookup succeeded. */
  digest: z.string().optional(),
  /** Compressed image size (config + layers); absent for multi-arch indexes. */
  sizeBytes: z.number().optional(),
});

/** Probe-style result: a failed listing is a result, not an RPC error. */
const listTagsOutput = z.object({
  ok: z.boolean(),
  tags: z.array(tagInfoSchema),
  /** True when the repository has more tags than the page limit (~50). */
  truncated: z.boolean(),
  status: z.number().optional(),
  message: z.string().optional(),
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
  testConnection: oc
    .errors({
      NOT_FOUND: { status: 404, message: "Registry credential not found" as const },
    })
    .meta({ path: `${basePath}/test-connection`, tag, method: "POST" })
    .input(testConnectionInput)
    .output(testConnectionOutput),
  listTags: oc
    .errors({
      NOT_FOUND: { status: 404, message: "Registry credential not found" as const },
    })
    .meta({ path: `${basePath}/tags`, tag, method: "GET" })
    .input(listTagsInput)
    .output(listTagsOutput),
};
