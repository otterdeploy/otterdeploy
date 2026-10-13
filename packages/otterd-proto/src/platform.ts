/**
 * The platform boot manifest (`otterd/platform-boot-manifest/v1`); mirror of
 * `platform.rs`. Signed by the install's recovery key. The boot-closure checks
 * (`preflight`) run in otterd; this mirror covers the document's shape.
 */
import * as z from "zod";

import { hostBinding } from "./identity";
import { sha256Hex, u16, u53, wireId } from "./primitives";

export const PLATFORM_MANIFEST_SCHEMA = 1;
export const PLATFORM_DATA_ROOT = "/var/lib/otterd/platform";

export const PLATFORM_ROLES = ["postgres", "redis", "control-plane", "edge", "connector"] as const;
export const platformRole = z.enum(PLATFORM_ROLES);

export const platformImage = z.strictObject({
  reference: z.string(),
  id: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  archive: z.string(),
  archiveSha256: sha256Hex,
});

export const platformReadiness = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("tcp"), port: u16 }),
  z.strictObject({ kind: z.literal("exec"), argv: z.array(z.string()) }),
  z.strictObject({ kind: z.literal("http"), port: u16, path: z.string() }),
]);

export const platformMember = z.strictObject({
  name: z.string(),
  role: platformRole,
  image: platformImage,
  cmd: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  recoveryEnv: z.record(z.string(), z.string()).optional(),
  data: z
    .array(
      z.strictObject({ root: z.string(), target: z.string(), readOnly: z.boolean().optional() }),
    )
    .optional(),
  ip: z.string(),
  publish: z
    .array(z.strictObject({ hostIp: z.string(), hostPort: u16, containerPort: u16 }))
    .optional(),
  dependsOn: z.array(z.string()).optional(),
  readiness: platformReadiness,
  essentialConnector: z.boolean().optional(),
});

export const platformBootManifest = z.strictObject({
  schema: u16,
  installId: wireId,
  host: hostBinding,
  bootstrapEpoch: u53,
  manifestRevision: u53,
  authorityTerm: u53,
  previousManifestDigest: sha256Hex.optional(),
  compatibleRollback: z.array(sha256Hex).optional(),
  network: z.strictObject({ name: z.string(), subnet: z.string(), gateway: z.string() }),
  members: z.array(platformMember),
  recoveryListener: z.string().optional(),
  preflight: z
    .strictObject({
      requireNftTable: z.string().optional(),
      forbidUnits: z.array(z.string()).optional(),
    })
    .optional(),
});
export type PlatformBootManifest = z.infer<typeof platformBootManifest>;
