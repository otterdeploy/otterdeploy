/**
 * Trusted-CA store handlers — upload (validated as an actual CA via
 * basicConstraints), list, delete. Split out of handlers.ts, which keeps
 * the custom-certificate write path.
 */
import type { TrustedCaId } from "@otterdeploy/shared/id";

import { Result, panic } from "better-result";

import type { OrgRef } from "../scopes";
import type { TrustedCaRecord } from "./queries";

import { parseCertificateChain } from "../../lib/x509";
import { isUniqueViolation } from "../project/views";
import { TrustedCaConflictError, TrustedCaInvalidError, TrustedCaNotFoundError } from "./errors";
import { deleteTrustedCaRecord, insertTrustedCa, listTrustedCasByOrg } from "./queries";

export async function listTrustedCas(input: OrgRef): Promise<TrustedCaRecord[]> {
  return listTrustedCasByOrg(input.organizationId);
}

export async function uploadTrustedCa(
  input: { name: string; pem: string } & OrgRef,
): Promise<Result<TrustedCaRecord, TrustedCaInvalidError | TrustedCaConflictError>> {
  const parsed = parseCertificateChain(input.pem);
  if (!parsed.ok) return Result.err(new TrustedCaInvalidError({ message: parsed.error }));
  const { leaf } = parsed;
  if (!leaf.isCa) {
    return Result.err(
      new TrustedCaInvalidError({
        message:
          "this certificate is not a CA (basicConstraints CA:TRUE missing) — for a server certificate use Upload custom instead",
      }),
    );
  }

  const inserted = await Result.tryPromise({
    try: () =>
      insertTrustedCa({
        organizationId: input.organizationId,
        name: input.name.trim(),
        pem: input.pem,
        subject: leaf.subject,
        fingerprint256: leaf.fingerprint256,
        notAfter: new Date(leaf.notAfter),
      }),
    catch: (cause) =>
      isUniqueViolation(cause)
        ? new TrustedCaConflictError({ fingerprint: leaf.fingerprint256 })
        : panic("certificates.uploadCa: unexpected DB error", cause),
  });
  if (Result.isError(inserted)) return Result.err(inserted.error);
  if (!inserted.value) {
    return Result.err(new TrustedCaConflictError({ fingerprint: leaf.fingerprint256 }));
  }
  return Result.ok(inserted.value);
}

export async function deleteTrustedCa(
  input: { id: TrustedCaId } & OrgRef,
): Promise<Result<{ ok: true }, TrustedCaNotFoundError>> {
  const deleted = await deleteTrustedCaRecord({
    id: input.id,
    organizationId: input.organizationId,
  });
  if (!deleted) return Result.err(new TrustedCaNotFoundError({ id: input.id }));
  return Result.ok({ ok: true });
}
