/**
 * Custom-certificate material validation + domain matching — pure helpers
 * over lib/x509, shared by the upload and replace paths in handlers.ts.
 */
import { Result } from "better-result";

import type { CustomCertificateWithUploader } from "./queries";

import {
  certCoversDomain,
  checkKeyMatchesCertificate,
  parseCertificateChain,
  type ParsedCertificate,
} from "../../lib/x509";
import { CertificateInvalidError } from "./errors";

/** Which of the org's enabled domains does this stored cert cover? */
export function matchingDomainsFor(
  cert: Pick<CustomCertificateWithUploader, "hostname" | "subject" | "sans">,
  domains: string[],
): string[] {
  const subjectCN = cert.subject?.match(/(?:^|, )CN=([^,]+)/)?.[1] ?? null;
  return domains.filter(
    (d) =>
      d.toLowerCase() === cert.hostname.toLowerCase() ||
      certCoversDomain({ subjectCN, sans: cert.sans }, d),
  );
}

export interface ValidatedUpload {
  leaf: ParsedCertificate;
  hostname: string;
}

/** Requested hostname (or the leaf-derived one) must exist and be covered
 *  by the certificate's CN/SANs. */
function resolveCoveredHostname(
  leaf: ParsedCertificate,
  requested: string | undefined,
): Result<string, CertificateInvalidError> {
  const derived = leaf.subjectCN ?? leaf.sans[0] ?? null;
  const hostname = requested ?? derived?.toLowerCase() ?? null;
  if (!hostname) {
    return Result.err(
      new CertificateInvalidError({
        message: "certificate has no usable hostname (no subject CN and no DNS SANs)",
      }),
    );
  }
  if (!certCoversDomain({ subjectCN: leaf.subjectCN, sans: leaf.sans }, hostname)) {
    return Result.err(
      new CertificateInvalidError({
        message: `certificate does not cover ${hostname} (subject ${leaf.subjectCN ?? "—"}, SANs ${
          leaf.sans.join(", ") || "—"
        })`,
      }),
    );
  }
  return Result.ok(hostname);
}

/** Shared upload/replace validation: chain parses, it isn't a bare CA, the
 *  key pairs with the leaf, and the hostname (given or derived) is covered. */
export function validateCustomCertMaterial(input: {
  hostname?: string;
  certPem: string;
  keyPem: string;
  /** When replacing, the hostname is fixed by the existing row. */
  fixedHostname?: string;
}): Result<ValidatedUpload, CertificateInvalidError> {
  const parsed = parseCertificateChain(input.certPem);
  if (!parsed.ok) return Result.err(new CertificateInvalidError({ message: parsed.error }));
  const { leaf } = parsed;

  if (leaf.isCa && leaf.sans.length === 0) {
    return Result.err(
      new CertificateInvalidError({
        message:
          "this looks like a CA certificate, not a server certificate — add it under Trusted CAs instead",
      }),
    );
  }

  const keyCheck = checkKeyMatchesCertificate(input.certPem, input.keyPem);
  if (!keyCheck.ok) return Result.err(new CertificateInvalidError({ message: keyCheck.error }));

  const requested = input.fixedHostname ?? input.hostname?.trim().toLowerCase();
  const hostname = resolveCoveredHostname(leaf, requested);
  if (Result.isError(hostname)) return Result.err(hostname.error);
  return Result.ok({ leaf, hostname: hostname.value });
}
