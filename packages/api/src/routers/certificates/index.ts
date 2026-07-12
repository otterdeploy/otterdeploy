/**
 * Certificates router — org-wide TLS: live inventory probes, custom cert
 * upload/replace/delete (installed through the shared Caddy reconcile pass),
 * and the trusted-CA store. All procedures are RBAC-gated on the
 * `certificate` resource (members: read-only). Private keys never appear in
 * any output — the contract has no field for them.
 */
import type { UserId } from "@otterdeploy/shared/id";
import type * as z from "zod";

import { matchError } from "better-result";

import type { customCertificateSchema, trustedCaSchema } from "./contract";
import type { CustomCertView } from "./handlers";
import type { TrustedCaRecord } from "./queries";

import { requirePermission } from "../..";
import {
  deleteCustomCertificate,
  deleteTrustedCa,
  listCustomCertificates,
  listOrgCertificates,
  listTrustedCas,
  replaceCustomCertificate,
  uploadCustomCertificate,
  uploadTrustedCa,
} from "./handlers";

type CustomCertPublic = z.infer<typeof customCertificateSchema>;
type TrustedCaPublic = z.infer<typeof trustedCaSchema>;

/** DB row → wire shape. Drops `certPem` + `keyCiphertext` (the chain is
 *  large and the key must never leave the server) and the raw user id. */
function toCustomPublic(row: CustomCertView): CustomCertPublic {
  return {
    id: row.id,
    hostname: row.hostname,
    issuer: row.issuer,
    subject: row.subject,
    serial: row.serial,
    sans: row.sans,
    notBefore: row.notBefore,
    notAfter: row.notAfter,
    fingerprint256: row.fingerprint256,
    keyAlg: row.keyAlg,
    installState: row.installState,
    installError: row.installError,
    uploadedBy: row.uploadedBy,
    matchingDomains: row.matchingDomains,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toCaPublic(row: TrustedCaRecord): TrustedCaPublic {
  return {
    id: row.id,
    name: row.name,
    subject: row.subject,
    fingerprint256: row.fingerprint256,
    notAfter: row.notAfter,
    pem: row.pem,
    createdAt: row.createdAt,
  };
}

export const certificatesRouter = {
  inventory: requirePermission({ certificate: ["read"] }).certificates.inventory.handler(
    async ({ context }) => {
      return listOrgCertificates({ organizationId: context.activeOrganizationId });
    },
  ),

  listCustom: requirePermission({ certificate: ["read"] }).certificates.listCustom.handler(
    async ({ context }) => {
      const rows = await listCustomCertificates({
        organizationId: context.activeOrganizationId,
      });
      return rows.map(toCustomPublic);
    },
  ),

  uploadCustom: requirePermission({ certificate: ["create"] }).certificates.uploadCustom.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "certificate" } });
      const result = await uploadCustomCertificate({
        ...input,
        organizationId: context.activeOrganizationId,
        uploadedByUserId: (context.session?.user.id as UserId | undefined) ?? null,
        rlog: context.log,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          CertificateInvalidError: (e) => errors.INVALID_INPUT({ message: e.message }),
          CertificateConflictError: () => errors.CONFLICT(),
        });
      }
      context.log.set({ target: { type: "certificate", id: result.value.certificate.id } });
      return {
        certificate: toCustomPublic(result.value.certificate),
        applied: result.value.applied,
        applyError: result.value.applyError,
      };
    },
  ),

  replaceCustom: requirePermission({ certificate: ["update"] }).certificates.replaceCustom.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "certificate", id: input.id } });
      const result = await replaceCustomCertificate({
        ...input,
        organizationId: context.activeOrganizationId,
        uploadedByUserId: (context.session?.user.id as UserId | undefined) ?? null,
        rlog: context.log,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          CertificateInvalidError: (e) => errors.INVALID_INPUT({ message: e.message }),
          CertificateNotFoundError: () => errors.NOT_FOUND(),
        });
      }
      return {
        certificate: toCustomPublic(result.value.certificate),
        applied: result.value.applied,
        applyError: result.value.applyError,
      };
    },
  ),

  deleteCustom: requirePermission({ certificate: ["delete"] }).certificates.deleteCustom.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "certificate", id: input.id } });
      const result = await deleteCustomCertificate({
        id: input.id,
        organizationId: context.activeOrganizationId,
        rlog: context.log,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          CertificateNotFoundError: () => errors.NOT_FOUND(),
        });
      }
      return result.value;
    },
  ),

  listCas: requirePermission({ certificate: ["read"] }).certificates.listCas.handler(
    async ({ context }) => {
      const rows = await listTrustedCas({ organizationId: context.activeOrganizationId });
      return rows.map(toCaPublic);
    },
  ),

  uploadCa: requirePermission({ certificate: ["create"] }).certificates.uploadCa.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "trustedCa" } });
      const result = await uploadTrustedCa({
        ...input,
        organizationId: context.activeOrganizationId,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          TrustedCaInvalidError: (e) => errors.INVALID_INPUT({ message: e.message }),
          TrustedCaConflictError: () => errors.CONFLICT(),
        });
      }
      context.log.set({ target: { type: "trustedCa", id: result.value.id } });
      return toCaPublic(result.value);
    },
  ),

  deleteCa: requirePermission({ certificate: ["delete"] }).certificates.deleteCa.handler(
    async ({ input, context, errors }) => {
      context.log.set({ target: { type: "trustedCa", id: input.id } });
      const result = await deleteTrustedCa({
        id: input.id,
        organizationId: context.activeOrganizationId,
      });
      if (result.isErr()) {
        throw matchError(result.error, {
          TrustedCaNotFoundError: () => errors.NOT_FOUND(),
        });
      }
      return result.value;
    },
  ),
};
