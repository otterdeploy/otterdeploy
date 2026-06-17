/**
 * SSH keys oRPC contract. Org-scoped CRUD for Git deploy keys + node-management
 * keys. The private half is NEVER part of any output schema — generate/rotate
 * return only the public row (the private key is encrypted at rest and used
 * server-side to authenticate; operators copy the PUBLIC key to their Git host).
 */
import { oc } from "@orpc/contract";
import { ID_PREFIX, zId } from "@otterdeploy/shared/id";
import * as z from "zod";

const tag = "sshKeys";
const basePath = "/ssh-keys";

const sshKeyIdField = zId(ID_PREFIX.sshKey);

const sshKeyTypeSchema = z.enum(["ed25519", "rsa", "ecdsa"]);

/** Where a key is consumed, derived at read time (never denormalized). */
const sshKeyUsageSchema = z.object({
  kind: z.enum(["git", "node", "service"]),
  label: z.string(),
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
    })
    .route({ method: "POST", path: `${basePath}/{id}/rotate`, tags: [tag] })
    .input(rotateSshKeyInput)
    .output(sshKeySchema),

  delete: oc
    .errors({
      NOT_FOUND: { status: 404, message: "SSH key not found" as const },
    })
    .route({ method: "DELETE", path: `${basePath}/{id}`, tags: [tag] })
    .input(deleteSshKeyInput)
    .output(z.object({ ok: z.literal(true) })),
};
