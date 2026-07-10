/**
 * X.509 PEM parsing + validation for operator-uploaded certificate material
 * (custom edge certs, trusted CAs). Pure functions over `node:crypto`'s
 * `X509Certificate` — no I/O, no DB — so everything here is unit-testable
 * with plain PEM fixtures. Failures are returned as discriminated results,
 * never thrown: the caller (the certificates router) maps them onto its
 * typed domain errors.
 */

import type { KeyObject } from "node:crypto";

import { createPrivateKey, X509Certificate } from "node:crypto";

const PEM_CERT_BLOCK = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

/** Extracted metadata of a single certificate (the leaf, for chains). */
export interface ParsedCertificate {
  /** Subject CN, e.g. "app.example.com". */
  subjectCN: string | null;
  /** Full subject line, "CN=x, O=y". */
  subject: string | null;
  /** Issuer org (preferred) or CN — matches the live probe's convention. */
  issuer: string | null;
  serial: string | null;
  /** DNS subject-alternative names. */
  sans: string[];
  /** ISO-8601. */
  notBefore: string;
  notAfter: string;
  /** SHA-256 fingerprint, "AA:BB:…" — same format as cert-probe's
   *  `fingerprint256`, so served-vs-stored is a string comparison. */
  fingerprint256: string;
  /** Human key description, e.g. "RSA 2048" / "ECDSA P-256" / "Ed25519". */
  keyAlg: string | null;
  /** True when the certificate is a CA (basicConstraints CA:TRUE). */
  isCa: boolean;
  selfSigned: boolean;
}

export type ParseChainResult =
  | { ok: true; leaf: ParsedCertificate; certCount: number }
  | { ok: false; error: string };

export type KeyMatchResult = { ok: true } | { ok: false; error: string };

/** Split a PEM blob into its individual CERTIFICATE blocks (order preserved). */
export function splitPemCertificates(pem: string): string[] {
  return pem.match(PEM_CERT_BLOCK) ?? [];
}

/** Node's `.subject`/`.issuer` are newline-separated "K=V" lines. */
function dnField(dn: string | undefined, key: string): string | null {
  if (!dn) return null;
  for (const line of dn.split("\n")) {
    const idx = line.indexOf("=");
    if (idx !== -1 && line.slice(0, idx).trim() === key) {
      const v = line.slice(idx + 1).trim();
      if (v.length > 0) return v;
    }
  }
  return null;
}

function dnOneLine(dn: string | undefined): string | null {
  if (!dn) return null;
  const flat = dn.split("\n").filter(Boolean).join(", ");
  return flat.length > 0 ? flat : null;
}

function parseSans(subjectAltName: string | undefined): string[] {
  if (!subjectAltName) return [];
  return subjectAltName
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.startsWith("DNS:"))
    .map((p) => p.slice("DNS:".length));
}

function describeKeyAlg(publicKey: KeyObject): string | null {
  const type = publicKey.asymmetricKeyType;
  const details = publicKey.asymmetricKeyDetails;
  switch (type) {
    case "rsa":
    case "rsa-pss":
      return details?.modulusLength ? `RSA ${details.modulusLength}` : "RSA";
    case "ec": {
      // prime256v1/secp384r1 → the P-xxx names operators recognize.
      const curve = details?.namedCurve ?? null;
      const pretty =
        curve === "prime256v1" || curve === "secp256r1"
          ? "P-256"
          : curve === "secp384r1"
            ? "P-384"
            : curve === "secp521r1"
              ? "P-521"
              : curve;
      return pretty ? `ECDSA ${pretty}` : "ECDSA";
    }
    case "ed25519":
      return "Ed25519";
    case "ed448":
      return "Ed448";
    default:
      return type ?? null;
  }
}

function shapeCertificate(cert: X509Certificate): ParsedCertificate {
  const subjectCN = dnField(cert.subject, "CN");
  const issuer = dnField(cert.issuer, "O") ?? dnField(cert.issuer, "CN");
  return {
    subjectCN,
    subject: dnOneLine(cert.subject),
    issuer,
    serial: cert.serialNumber ?? null,
    sans: parseSans(cert.subjectAltName),
    notBefore: new Date(cert.validFrom).toISOString(),
    notAfter: new Date(cert.validTo).toISOString(),
    fingerprint256: cert.fingerprint256,
    keyAlg: describeKeyAlg(cert.publicKey),
    isCa: cert.ca,
    selfSigned: cert.subject === cert.issuer,
  };
}

/**
 * Parse an uploaded PEM chain. The FIRST certificate block is taken as the
 * leaf (the standard server-chain order); intermediates are parsed only to
 * confirm they're well-formed. Never throws.
 */
export function parseCertificateChain(pem: string): ParseChainResult {
  const blocks = splitPemCertificates(pem);
  if (blocks.length === 0) {
    return {
      ok: false,
      error: "no CERTIFICATE block found — paste the PEM chain, leaf certificate first",
    };
  }
  let leaf: X509Certificate;
  try {
    leaf = new X509Certificate(blocks[0]!);
  } catch (cause) {
    return { ok: false, error: certError("certificate did not parse", cause) };
  }
  for (let i = 1; i < blocks.length; i++) {
    try {
      // Parse-only: confirms each intermediate is a well-formed certificate.
      new X509Certificate(blocks[i]!);
    } catch (cause) {
      return { ok: false, error: certError(`chain certificate #${i + 1} did not parse`, cause) };
    }
  }
  return { ok: true, leaf: shapeCertificate(leaf), certCount: blocks.length };
}

/**
 * Verify a PEM private key parses and is the pair of the given leaf
 * certificate. Encrypted (passphrase-protected) keys are rejected with an
 * actionable message. Never throws.
 */
export function checkKeyMatchesCertificate(certPem: string, keyPem: string): KeyMatchResult {
  const blocks = splitPemCertificates(certPem);
  if (blocks.length === 0) return { ok: false, error: "no CERTIFICATE block found" };
  if (/ENCRYPTED/.test(keyPem)) {
    return {
      ok: false,
      error: "private key is passphrase-protected — upload an unencrypted PEM key",
    };
  }
  let key: KeyObject;
  try {
    key = createPrivateKey(keyPem);
  } catch (cause) {
    return { ok: false, error: certError("private key did not parse", cause) };
  }
  try {
    const leaf = new X509Certificate(blocks[0]!);
    if (!leaf.checkPrivateKey(key)) {
      return { ok: false, error: "private key does not match the certificate's public key" };
    }
  } catch (cause) {
    return { ok: false, error: certError("certificate did not parse", cause) };
  }
  return { ok: true };
}

/**
 * Does a certificate (CN + SANs) cover `domain`? Exact match, or a
 * single-label wildcard (`*.example.com` covers `a.example.com`, not
 * `a.b.example.com` and not `example.com`) — the same matching TLS clients
 * apply. Case-insensitive.
 */
export function certCoversDomain(
  names: { subjectCN: string | null; sans: string[] },
  domain: string,
): boolean {
  const target = domain.trim().toLowerCase();
  if (target.length === 0) return false;
  const candidates = [...names.sans, ...(names.subjectCN ? [names.subjectCN] : [])].map((n) =>
    n.trim().toLowerCase(),
  );
  for (const name of candidates) {
    if (name === target) return true;
    if (name.startsWith("*.")) {
      const suffix = name.slice(1); // ".example.com"
      if (
        target.endsWith(suffix) &&
        // exactly one extra label: nothing before the suffix may contain a dot
        target.length > suffix.length &&
        !target.slice(0, target.length - suffix.length).includes(".")
      ) {
        return true;
      }
    }
  }
  return false;
}

function certError(prefix: string, cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return `${prefix}: ${detail}`;
}
