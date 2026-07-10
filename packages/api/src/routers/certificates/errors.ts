import type { CustomCertificateId, TrustedCaId } from "@otterdeploy/shared/id";

import { TaggedError } from "better-result";

/** The PEM chain / private key didn't validate (parse failure, key mismatch,
 *  hostname not covered, CA-vs-leaf confusion…). Message is operator-facing. */
export class CertificateInvalidError extends TaggedError("CertificateInvalidError")<{
  message: string;
}>() {
  constructor(args: { message: string }) {
    super({ message: args.message });
  }
}

export class CertificateNotFoundError extends TaggedError("CertificateNotFoundError")<{
  message: string;
  id: CustomCertificateId;
}>() {
  constructor(args: { id: CustomCertificateId }) {
    super({ id: args.id, message: `custom certificate ${args.id} not found` });
  }
}

export class CertificateConflictError extends TaggedError("CertificateConflictError")<{
  message: string;
  hostname: string;
}>() {
  constructor(args: { hostname: string }) {
    super({
      hostname: args.hostname,
      message: `a custom certificate for ${args.hostname} already exists — replace it instead`,
    });
  }
}

export class TrustedCaInvalidError extends TaggedError("TrustedCaInvalidError")<{
  message: string;
}>() {
  constructor(args: { message: string }) {
    super({ message: args.message });
  }
}

export class TrustedCaNotFoundError extends TaggedError("TrustedCaNotFoundError")<{
  message: string;
  id: TrustedCaId;
}>() {
  constructor(args: { id: TrustedCaId }) {
    super({ id: args.id, message: `trusted CA ${args.id} not found` });
  }
}

export class TrustedCaConflictError extends TaggedError("TrustedCaConflictError")<{
  message: string;
  fingerprint: string;
}>() {
  constructor(args: { fingerprint: string }) {
    super({
      fingerprint: args.fingerprint,
      message: `a CA with fingerprint ${args.fingerprint} is already in the store`,
    });
  }
}
