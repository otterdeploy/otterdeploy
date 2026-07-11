/**
 * Certificates oRPC contract — the org-wide TLS surface.
 *
 * Three planes, with different levels of enforcement (stated honestly):
 *
 *   - `inventory` — GROUND TRUTH. Live TLS probes of every enabled public
 *     domain across the org's projects (same probe as the per-project
 *     Networking tab): what the edge is actually serving right now. Never
 *     cached, never synthesized.
 *   - custom certificates — operator-uploaded PEM chain + key. Validated and
 *     stored server-side, materialized to the edge's `/etc/caddy` mount and
 *     emitted as `tls` directives by the reconciler. `installState` +
 *     `applied` report the real outcome; the private key is NEVER part of
 *     any output schema.
 *   - trusted CAs — inventory only today. The generated edge config proxies
 *     upstreams over plain HTTP on the internal network, so no generated
 *     directive consumes a CA pool; rows are stored for download/reference.
 *
 * There is deliberately NO "renew" procedure: Caddy renews ACME certs on its
 * own schedule and its admin API exposes no force-renew endpoint — a renew
 * button here would be fiction. Recheck (re-probe) is the honest verb.
 */
import { oc } from "@orpc/contract";
import { ID_PREFIX, zId } from "@otterdeploy/shared/id";
import * as z from "zod";

const tag = "certificates";
const basePath = "/certificates";

const customCertificateIdField = zId(ID_PREFIX.customCertificate);
const trustedCaIdField = zId(ID_PREFIX.trustedCa);

// ─── org-wide inventory (live edge probe) ───────────────────────────

/** One probed domain — mirrors lib/cert-probe's CertProbe, plus which
 *  projects publish the domain and (when the served leaf's fingerprint
 *  matches a stored custom cert) which upload is live. */
const probedCertificateSchema = z.object({
  domain: z.string(),
  ok: z.boolean(),
  error: z.string().nullable(),
  issuer: z.string().nullable(),
  subject: z.string().nullable(),
  sans: z.array(z.string()),
  notBefore: z.string().nullable(),
  notAfter: z.string().nullable(),
  daysRemaining: z.number().nullable(),
  serial: z.string().nullable(),
  fingerprint: z.string().nullable(),
  selfSigned: z.boolean(),
  status: z.enum(["valid", "expiring", "expired", "internal", "error"]),
  /** Projects whose routes publish this domain. */
  projects: z.array(
    z.object({
      id: zId(ID_PREFIX.project),
      name: z.string(),
      slug: z.string(),
    }),
  ),
  /** Set when the SERVED leaf is one of this org's uploaded custom certs
   *  (SHA-256 fingerprint match against the live probe) — ground truth that
   *  the upload is what the edge presents. */
  customCertificateId: customCertificateIdField.nullable(),
});

const inventorySchema = z.object({
  /** The edge address probed (server IP, or loopback on a single node). */
  edgeHost: z.string(),
  /** ISO-8601 — when the probe ran (results are live, not cached). */
  probedAt: z.string(),
  certificates: z.array(probedCertificateSchema),
});

// ─── custom certificates (uploaded PEM) ─────────────────────────────

export const customCertificateInstallStateSchema = z.enum(["pending", "installed", "error"]);

/** Public row — extracted leaf metadata only, never key material. */
export const customCertificateSchema = z.object({
  id: customCertificateIdField,
  hostname: z.string(),
  issuer: z.string().nullable(),
  subject: z.string().nullable(),
  serial: z.string().nullable(),
  sans: z.array(z.string()),
  notBefore: z.date(),
  notAfter: z.date(),
  /** SHA-256 leaf fingerprint — comparable to the inventory probe's. */
  fingerprint256: z.string(),
  keyAlg: z.string().nullable(),
  /** Real install outcome: "installed" = a reconcile including this cert
   *  loaded at the edge; "pending" = stored, not yet confirmed; "error" =
   *  installation failed (see installError). */
  installState: customCertificateInstallStateSchema,
  installError: z.string().nullable(),
  /** Display name of the uploader (null for API-key actors / deleted users). */
  uploadedBy: z.string().nullable(),
  /** Enabled public domains (across the org's projects) this cert covers —
   *  empty means nothing routes to it yet, so it cannot be served. */
  matchingDomains: z.array(z.string()),
  createdAt: z.date(),
  updatedAt: z.date(),
});

const PEM_CERT_MAX = 64_000;
const PEM_KEY_MAX = 16_000;

const uploadCustomInput = z.object({
  /** Optional — must be covered by the cert's CN/SANs when given; derived
   *  from the leaf (CN, else first SAN) when omitted. */
  hostname: z.string().trim().min(1).max(255).optional(),
  /** PEM chain, leaf first. */
  certPem: z.string().min(1).max(PEM_CERT_MAX),
  /** Unencrypted PEM private key. Write-only — never echoed back. */
  keyPem: z.string().min(1).max(PEM_KEY_MAX),
});

const replaceCustomInput = z.object({
  id: customCertificateIdField,
  certPem: z.string().min(1).max(PEM_CERT_MAX),
  keyPem: z.string().min(1).max(PEM_KEY_MAX),
});

/** Mutation result carries the honest edge outcome, not just the row. */
const customCertificateWriteResult = z.object({
  certificate: customCertificateSchema,
  /** True when the edge config including this cert validated AND loaded. */
  applied: z.boolean(),
  /** Why it didn't apply (files not writable / edge rejected the config).
   *  The row is stored either way; `installState` mirrors this. */
  applyError: z.string().nullable(),
});

// ─── trusted CAs (inventory) ────────────────────────────────────────

export const trustedCaSchema = z.object({
  id: trustedCaIdField,
  name: z.string(),
  subject: z.string().nullable(),
  fingerprint256: z.string(),
  notAfter: z.date(),
  /** Public material — included so the UI can view/download the PEM. */
  pem: z.string(),
  createdAt: z.date(),
});

const uploadCaInput = z.object({
  name: z.string().trim().min(1).max(64),
  pem: z.string().min(1).max(PEM_CERT_MAX),
});

// GET endpoints must declare an object/any/unknown input for the OpenAPI
// generator (`z.void()` is rejected); `.optional()` keeps "no input" valid.
const emptyInput = z.object({}).optional();

const INVALID_PEM = {
  status: 400,
  message: "Invalid certificate material" as const,
};

export const certificatesContract = {
  inventory: oc
    .route({ method: "GET", path: basePath, tags: [tag] })
    .input(emptyInput)
    .output(inventorySchema),

  listCustom: oc
    .route({ method: "GET", path: `${basePath}/custom`, tags: [tag] })
    .input(emptyInput)
    .output(z.array(customCertificateSchema)),

  uploadCustom: oc
    .errors({
      INVALID_INPUT: INVALID_PEM,
      CONFLICT: {
        status: 409,
        message: "A custom certificate for this hostname already exists" as const,
      },
    })
    .route({ method: "POST", path: `${basePath}/custom`, tags: [tag] })
    .input(uploadCustomInput)
    .output(customCertificateWriteResult),

  replaceCustom: oc
    .errors({
      INVALID_INPUT: INVALID_PEM,
      NOT_FOUND: { status: 404, message: "Certificate not found" as const },
    })
    .route({ method: "POST", path: `${basePath}/custom/{id}/replace`, tags: [tag] })
    .input(replaceCustomInput)
    .output(customCertificateWriteResult),

  deleteCustom: oc
    .errors({
      NOT_FOUND: { status: 404, message: "Certificate not found" as const },
    })
    .route({ method: "DELETE", path: `${basePath}/custom/{id}`, tags: [tag] })
    .input(z.object({ id: customCertificateIdField }))
    .output(z.object({ ok: z.literal(true) })),

  listCas: oc
    .route({ method: "GET", path: `${basePath}/cas`, tags: [tag] })
    .input(emptyInput)
    .output(z.array(trustedCaSchema)),

  uploadCa: oc
    .errors({
      INVALID_INPUT: INVALID_PEM,
      CONFLICT: {
        status: 409,
        message: "This CA is already in the store" as const,
      },
    })
    .route({ method: "POST", path: `${basePath}/cas`, tags: [tag] })
    .input(uploadCaInput)
    .output(trustedCaSchema),

  deleteCa: oc
    .errors({
      NOT_FOUND: { status: 404, message: "CA not found" as const },
    })
    .route({ method: "DELETE", path: `${basePath}/cas/{id}`, tags: [tag] })
    .input(z.object({ id: trustedCaIdField }))
    .output(z.object({ ok: z.literal(true) })),
};
