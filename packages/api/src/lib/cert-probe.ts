/**
 * TLS certificate probe — opens a TLS connection to the Caddy edge with the
 * domain as SNI and reads the leaf certificate it presents. This is the
 * ground-truth view of what's actually served (ACME/Let's Encrypt, `tls
 * internal` self-signed, expired, or mismatched), with no dependency on
 * Caddy's filesystem or admin API — Caddy has no "list all certs" endpoint.
 *
 * We connect to the edge directly (single-node: loopback; multi-node: the
 * platform server IP) rather than to the public domain, so Cloudflare-proxied
 * domains still report the ORIGIN cert Caddy serves, not Cloudflare's. SNI
 * (`servername`) is what makes Caddy pick the right cert. `rejectUnauthorized`
 * is off so we can still read self-signed/expired certs — we're inspecting,
 * not trusting.
 */

import { connect } from "node:tls";

export type CertStatus = "valid" | "expiring" | "expired" | "internal" | "error";

export interface CertProbe {
  domain: string;
  ok: boolean;
  error: string | null;
  /** Issuer org (e.g. "Let's Encrypt") or CN. */
  issuer: string | null;
  /** Subject CN. */
  subject: string | null;
  /** Subject alternative names (DNS entries). */
  sans: string[];
  /** ISO-8601. */
  notBefore: string | null;
  notAfter: string | null;
  daysRemaining: number | null;
  serial: string | null;
  /** SHA-256 fingerprint. */
  fingerprint: string | null;
  selfSigned: boolean;
  status: CertStatus;
}

/** Soon-to-expire threshold (days). Caddy renews ACME certs ~30d out, so this
 *  doubles as "should already be renewing". */
const EXPIRING_DAYS = 30;
const DEFAULT_TIMEOUT_MS = 5_000;

interface ProbeResult {
  cert: RawCert | null;
  error: string | null;
}

/** Open one TLS connection and resolve the presented leaf cert (or an error
 *  string). Never rejects — failure is returned, not thrown. */
function connectAndRead(opts: {
  host: string;
  port: number;
  servername: string;
  timeoutMs: number;
}): Promise<ProbeResult> {
  return new Promise<ProbeResult>((resolve) => {
    let settled = false;
    const done = (r: ProbeResult) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    const socket = connect(
      {
        host: opts.host,
        port: opts.port,
        servername: opts.servername,
        rejectUnauthorized: false,
        timeout: opts.timeoutMs,
      },
      () => {
        // `false` = the leaf's own fields (we don't walk the chain). Cast to
        // our structural subset so the rest of the module is socket-free.
        const cert = socket.getPeerCertificate(false) as unknown as RawCert;
        socket.end();
        const present = cert && Object.keys(cert).length > 0;
        done({
          cert: present ? cert : null,
          error: present ? null : "no certificate presented",
        });
      },
    );

    socket.once("timeout", () => {
      socket.destroy();
      done({ cert: null, error: "connection timed out" });
    });
    socket.once("error", (err: Error) => {
      done({ cert: null, error: err.message });
    });
  });
}

/** The leaf-cert fields we read — a structural subset of node's
 *  PeerCertificate, so the pure shaping logic can be unit-tested with plain
 *  objects (no live socket). */
export interface RawCert {
  issuer?: Record<string, string | undefined>;
  subject?: Record<string, string | undefined>;
  subjectaltname?: string;
  valid_from?: string;
  valid_to?: string;
  serialNumber?: string;
  fingerprint256?: string;
}

function fieldOf(
  rec: Record<string, string | undefined> | undefined,
  ...keys: string[]
): string | null {
  if (!rec) return null;
  for (const k of keys) {
    const v = rec[k];
    if (v && v.trim().length > 0) return v;
  }
  return null;
}

function parseSans(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.startsWith("DNS:"))
    .map((p) => p.slice("DNS:".length));
}

function toIso(value: string | undefined): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** Caddy's self-signed CA names itself this. */
function isInternalIssuer(issuer: string | null): boolean {
  return !!issuer && /caddy local authority/i.test(issuer);
}

function classify(
  notAfter: string | null,
  daysRemaining: number | null,
  selfSigned: boolean,
): CertStatus {
  if (notAfter && daysRemaining !== null && daysRemaining < 0) return "expired";
  if (selfSigned) return "internal";
  if (daysRemaining !== null && daysRemaining <= EXPIRING_DAYS) return "expiring";
  return "valid";
}

/** Pure: shape a raw leaf cert (or a probe error) into a CertProbe. Separated
 *  from the socket I/O so the classification/SAN/self-signed logic is unit
 *  testable with plain objects. */
export function shapeCertProbe(
  domain: string,
  cert: RawCert | null,
  error: string | null,
  now: number,
): CertProbe {
  const base: CertProbe = {
    domain,
    ok: false,
    error: null,
    issuer: null,
    subject: null,
    sans: [],
    notBefore: null,
    notAfter: null,
    daysRemaining: null,
    serial: null,
    fingerprint: null,
    selfSigned: false,
    status: "error",
  };

  if (!cert) return { ...base, error: error ?? "probe failed" };

  const issuer = fieldOf(cert.issuer, "O", "CN");
  const subject = fieldOf(cert.subject, "CN", "O");
  const notBefore = toIso(cert.valid_from);
  const notAfter = toIso(cert.valid_to);
  const daysRemaining =
    notAfter !== null ? Math.floor((Date.parse(notAfter) - now) / 86_400_000) : null;
  const selfSigned =
    isInternalIssuer(issuer) || (issuer !== null && subject !== null && issuer === subject);

  return {
    ...base,
    ok: true,
    issuer,
    subject,
    sans: parseSans(cert.subjectaltname),
    notBefore,
    notAfter,
    daysRemaining,
    serial: cert.serialNumber ?? null,
    fingerprint: cert.fingerprint256 ?? null,
    selfSigned,
    status: classify(notAfter, daysRemaining, selfSigned),
  };
}

/** Probe one domain at the edge and shape the result for the UI. */
export async function probeCertificate(opts: {
  domain: string;
  host: string;
  port?: number;
  timeoutMs?: number;
  now?: number;
}): Promise<CertProbe> {
  const { cert, error } = await connectAndRead({
    host: opts.host,
    port: opts.port ?? 443,
    servername: opts.domain,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
  return shapeCertProbe(opts.domain, cert, error, opts.now ?? Date.now());
}
