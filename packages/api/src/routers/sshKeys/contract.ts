/**
 * SSH keys oRPC contract. Org-scoped CRUD for the keys otterdeploy signs in to
 * servers with. The private half is NEVER part of any output schema.
 * Generate/rotate return only the public row (the private key is encrypted at
 * rest and used server-side to authenticate; operators copy the PUBLIC key to
 * a server's authorized_keys).
 */
import { oc } from "@orpc/contract";
import { ID_PREFIX, zId } from "@otterdeploy/shared/id";
import * as z from "zod";

import { projectRefs } from "../../authz/project-refs";

const tag = "sshKeys";
const basePath = "/ssh-keys";

const sshKeyIdField = zId(ID_PREFIX.sshKey);

const sshKeyTypeSchema = z.enum(["ed25519", "rsa", "ecdsa"]);

const serverIdField = zId(ID_PREFIX.server);

/** A server that signs in with the key (`server.ssh_key_id`), derived at read
 *  time (never denormalized). The only consumer today: Git clones over SSH
 *  aren't supported, so no git usage exists to report. */
const sshKeyUsageSchema = z.object({
  kind: z.literal("server"),
  serverId: serverIdField,
  name: z.string(),
  role: z.enum(["manager", "worker"]),
});

/** What a rotation did on one server. See rotateSshKey (handlers.ts). */
export const rotateServerResultSchema = z.object({
  serverId: serverIdField,
  name: z.string(),
  outcome: z.enum(["reauthorized", "old_key_kept", "failed", "rolled_back", "rollback_failed"]),
  step: z.enum(["connect", "add", "verify", "cleanup"]).nullable(),
  error: z.string().nullable(),
});

/** Public-facing key row. Note: no private key material. */
export const sshKeySchema = z.object({
  id: sshKeyIdField,
  name: z.string(),
  type: sshKeyTypeSchema,
  bits: z.number().int().nullable(),
  publicKey: z.string(),
  fingerprint: z.string(),
  comment: z.string().nullable(),
  imported: z.boolean(),
  /** True for generated keys (we hold the private half); false for imported. */
  hasPrivateKey: z.boolean(),
  usedBy: z.array(sshKeyUsageSchema),
  lastUsedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// GET endpoints must declare an object/any/unknown input for the OpenAPI
// generator (`z.void()` is rejected); `.optional()` keeps "no input" valid.
const listSshKeysInput = z.object({}).optional();

const generateSshKeyInput = z.object({
  name: z.string().min(1).max(64),
  type: sshKeyTypeSchema.default("ed25519"),
  /** Override key size (rsa/ecdsa). Ignored for ed25519. */
  bits: z.number().int().positive().optional(),
  comment: z.string().max(128).optional(),
  /** Optional passphrase to encrypt the private key before it's stored. */
  passphrase: z.string().optional(),
});

const importSshKeyInput = z.object({
  name: z.string().min(1).max(64),
  /** Full OpenSSH public-key line. */
  publicKey: z.string().min(1),
});

const rotateSshKeyInput = z.object({ id: sshKeyIdField });

/** The rotated key, plus what happened on each server that uses it. */
const rotatedSshKeySchema = sshKeySchema.extend({
  servers: z.array(rotateServerResultSchema),
});

const deleteSshKeyInput = z.object({ id: sshKeyIdField });

export const sshKeysContract = {
  list: oc
    .route({ method: "GET", path: basePath, tags: [tag] })
    .input(listSshKeysInput)
    .output(z.array(sshKeySchema)),

  generate: oc
    .errors({
      CONFLICT: {
        status: 409,
        message: "An SSH key with this fingerprint already exists" as const,
      },
    })
    .route({ method: "POST", path: `${basePath}/generate`, tags: [tag] })
    .input(generateSshKeyInput)
    .output(sshKeySchema),

  import: oc
    .errors({
      CONFLICT: {
        status: 409,
        message: "An SSH key with this fingerprint already exists" as const,
      },
      INVALID_INPUT: { status: 400, message: "Invalid public key" as const },
    })
    .route({ method: "POST", path: `${basePath}/import`, tags: [tag] })
    .input(importSshKeyInput)
    .output(sshKeySchema),

  rotate: oc
    .meta(projectRefs({ id: "none" }))
    .errors({
      NOT_FOUND: { status: 404, message: "SSH key not found" as const },
      CONFLICT: {
        status: 409,
        message: "An SSH key with this fingerprint already exists" as const,
      },
      INVALID_INPUT: {
        status: 400,
        message: "This key can't be rotated" as const,
      },
      // A server couldn't take the new key. Nothing was swapped; every server
      // still accepts the current key. `servers` says what happened on each.
      ROTATE_FAILED: {
        status: 502,
        message: "The key was not rotated: a server could not take the new key" as const,
        data: z.object({ servers: z.array(rotateServerResultSchema) }),
      },
    })
    .route({ method: "POST", path: `${basePath}/{id}/rotate`, tags: [tag] })
    .input(rotateSshKeyInput)
    .output(rotatedSshKeySchema),

  delete: oc
    .meta(projectRefs({ id: "none" }))
    .errors({
      NOT_FOUND: { status: 404, message: "SSH key not found" as const },
      // Servers still sign in with this key; deleting it would cut the
      // control plane off from them.
      IN_USE: {
        status: 409,
        message: "This key is in use by a server" as const,
        data: z.object({
          servers: z.array(z.object({ serverId: serverIdField, name: z.string() })),
        }),
      },
    })
    .route({ method: "DELETE", path: `${basePath}/{id}`, tags: [tag] })
    .input(deleteSshKeyInput)
    .output(z.object({ ok: z.literal(true) })),
};
