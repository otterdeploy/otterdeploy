/**
 * "Does this domain actually have a real certificate?" — asked of the edge
 * itself, over TLS, from inside the install.
 *
 * The gap this closes: `checkDomainReachability` only resolves DNS, so a
 * domain whose A record points here reads as `pointed` (green) even when
 * inbound 80/443 are blocked by a cloud firewall the control plane cannot
 * see. Caddy then never completes an ACME challenge and quietly keeps
 * serving `tls internal`, while the UI says VERIFIED and links to an
 * https:// URL that cannot load. Nothing in the system observed the
 * OUTCOME of issuance; this does.
 *
 * Deliberately a local probe: it dials the edge container on the shared
 * docker network with the domain as SNI, so it works without any external
 * vantage point and without egress. It answers "what certificate does the
 * edge serve for this name", which is the fact the operator needs. It does
 * NOT answer "is port 443 open to the internet" — that needs an outside
 * observer (see the install-time reachability probe).
 *
 * `authorized` comes back populated even with `rejectUnauthorized: false`:
 * the handshake completes either way and Node reports whether the chain
 * verified against its bundled roots. Caddy's local CA is installed into the
 * EDGE container's trust store, never this process's, so a self-signed
 * `tls internal` cert reliably lands as `untrusted` rather than passing.
 */

import type { PeerCertificate } from "node:tls";

import { Result } from "better-result";
import { connect } from "node:tls";

/**
 * What the edge is serving for a domain.
 *
 * - `trusted`: a publicly-trusted chain (ACME succeeded). The good state.
 * - `untrusted`: a certificate that doesn't verify — in practice Caddy's
 *   `tls internal` local CA. The domain works only for someone who clicks
 *   through a browser warning.
 * - `none`: the edge answered but produced no usable certificate at all
 *   (handshake alert). What control.dr34mw0rk5.com did while its ports
 *   were firewalled.
 * - `unreachable`: couldn't open a connection to the edge — no edge
 *   container (bare dev), or it isn't listening.
 */
export type CertState = "trusted" | "untrusted" | "none" | "unreachable";

export interface CertProbeResult {
  state: CertState;
  /** Issuer O (falling back to CN) for UI diagnostics: "Let's Encrypt" vs
   *  "Caddy Local Authority" tells the operator the whole story at a glance. */
  issuer: string | null;
  /** Leaf expiry, when a certificate was served. */
  expiresAt: Date | null;
  checkedAt: Date;
}

/** Service DNS names the edge answers to, newest naming first. Mirrors the
 *  candidates in `swarm/client.ts#findEdgeContainerId`: compose names it
 *  after the project, production installs keep the otterdeploy-* name. */
const EDGE_HOSTS = ["caddy", "otterdeploy-caddy", "otterdeploy-caddy-1"] as const;

/** Socket-level failures mean we never spoke TLS at all, which is a
 *  different fact from "spoke TLS and got nothing usable". */
const CONNECT_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT",
  "EAI_AGAIN",
]);

interface Handshake {
  authorized: boolean;
  cert: PeerCertificate;
}

function errorCode(cause: unknown): string | null {
  if (cause instanceof Error && "code" in cause && typeof cause.code === "string") {
    return cause.code;
  }
  return null;
}

/** An empty object is what Node hands back when the peer sent no certificate. */
function hasCertificate(cert: PeerCertificate): boolean {
  return Object.keys(cert).length > 0 && typeof cert.valid_to === "string";
}

/** A DN attribute repeats legally, so Node types these as `string |
 *  string[]`. Take the first value: this is a human-facing label, not an
 *  identity check. */
function firstValue(field: string | string[] | undefined): string | null {
  if (Array.isArray(field)) return field[0] ?? null;
  return field ?? null;
}

function issuerName(cert: PeerCertificate): string | null {
  const issuer = cert.issuer;
  if (!issuer) return null;
  return firstValue(issuer.O) ?? firstValue(issuer.CN);
}

function expiryOf(cert: PeerCertificate): Date | null {
  const parsed = new Date(cert.valid_to);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function handshake(input: {
  host: string;
  port: number;
  servername: string;
  timeoutMs: number;
}): Promise<Handshake> {
  return new Promise((resolve, reject) => {
    const socket = connect(
      {
        host: input.host,
        port: input.port,
        servername: input.servername,
        // We want the verification VERDICT, not an enforced connection: a
        // failing chain is the interesting answer here, not an error.
        rejectUnauthorized: false,
      },
      () => {
        const result = { authorized: socket.authorized, cert: socket.getPeerCertificate() };
        socket.destroy();
        resolve(result);
      },
    );
    socket.setTimeout(input.timeoutMs, () => {
      socket.destroy(Object.assign(new Error("edge TLS probe timed out"), { code: "ETIMEDOUT" }));
    });
    socket.once("error", (cause) => {
      socket.destroy();
      reject(cause);
    });
  });
}

/**
 * Probe one domain against the edge. Tries each known edge hostname in turn
 * so this works under compose and swarm without new configuration; the first
 * host that completes a TCP+TLS exchange wins, and only an all-hosts-failed
 * run reports `unreachable`.
 */
export async function probeDomainCertificate(input: {
  domain: string;
  hosts?: readonly string[];
  port?: number;
  timeoutMs?: number;
}): Promise<CertProbeResult> {
  const checkedAt = new Date();
  const hosts = input.hosts ?? EDGE_HOSTS;
  const port = input.port ?? 443;
  const timeoutMs = input.timeoutMs ?? 4000;

  let sawTlsFailure = false;
  for (const host of hosts) {
    const attempt = await Result.tryPromise({
      try: () => handshake({ host, port, servername: input.domain, timeoutMs }),
      catch: (cause) => cause,
    });

    if (attempt.isErr()) {
      // A TLS-level rejection means the edge IS there and refused to produce
      // a certificate for this name; keep that verdict rather than letting a
      // later unreachable host overwrite it.
      if (!CONNECT_ERROR_CODES.has(errorCode(attempt.error) ?? "")) sawTlsFailure = true;
      continue;
    }

    const { authorized, cert } = attempt.value;
    if (!hasCertificate(cert)) {
      return { state: "none", issuer: null, expiresAt: null, checkedAt };
    }
    return {
      state: authorized ? "trusted" : "untrusted",
      issuer: issuerName(cert),
      expiresAt: expiryOf(cert),
      checkedAt,
    };
  }

  return {
    state: sawTlsFailure ? "none" : "unreachable",
    issuer: null,
    expiresAt: null,
    checkedAt,
  };
}
