/**
 * What Settings → Domains says about the base domain, derived from what the
 * server measured (`organization.checkBaseDomainDns`). Kept pure so every
 * sentence the page prints about DNS is pinned by a test against the state
 * that produces it: the old page described a platform default that doesn't
 * exist and never mentioned the wildcard record at all.
 */

export type WildcardState = "pointing-here" | "pointing-elsewhere" | "not-resolving" | "unknown";
export type TxtState = "found" | "wrong-value" | "not-found" | "unknown";
export type StatusTone = "ok" | "warn" | "bad" | "muted";

export interface RecordStatus {
  tone: StatusTone;
  label: string;
}

export function wildcardStatus(check: {
  state: WildcardState;
  addresses: string[];
  proxied: boolean;
}): RecordStatus {
  switch (check.state) {
    case "pointing-here":
      return { tone: "ok", label: "Points here" };
    case "pointing-elsewhere":
      if (check.proxied) return { tone: "warn", label: "Proxied" };
      return { tone: "bad", label: `Points to ${check.addresses[0] ?? "another host"}` };
    case "not-resolving":
      return { tone: "warn", label: "Not found" };
    case "unknown":
      return { tone: "muted", label: "Couldn't check" };
  }
}

export function txtStatus(check: { state: TxtState }): RecordStatus {
  switch (check.state) {
    case "found":
      return { tone: "ok", label: "Found" };
    case "wrong-value":
      return { tone: "bad", label: "Wrong value" };
    case "not-found":
      return { tone: "warn", label: "Not found" };
    case "unknown":
      return { tone: "muted", label: "Couldn't check" };
  }
}

export interface Publishing {
  source: "org-base" | "local-base" | "sslip-fallback";
  suffix: string;
  certificate: "lets-encrypt" | "self-signed";
}

/**
 * The sentence under "New services publish at". It answers the two things an
 * operator needs before exposing anything: will the address resolve, and will
 * the certificate be trusted.
 */
export function publishNote(input: {
  publishing: Publishing;
  wildcard: WildcardState | null;
  /** The wildcard resolves into Cloudflare's proxy. */
  proxied?: boolean;
  /** The field holds an unsaved domain: the row is a preview. */
  preview: boolean;
}): string {
  if (input.preview) return "Preview. Applies to services exposed after you save.";
  const { publishing, wildcard } = input;
  if (publishing.source === "sslip-fallback") {
    return "Temporary address on this server's IP. Self-signed certificate, and you're asked before a service is published on it.";
  }
  if (publishing.source === "local-base") {
    return "Local development address. Self-signed certificate.";
  }
  if (wildcard === "pointing-here") {
    return publishing.certificate === "lets-encrypt"
      ? "Reachable, with a Let's Encrypt certificate."
      : "Reachable, with a self-signed certificate.";
  }
  if (wildcard === "pointing-elsewhere" && input.proxied) {
    return "Reachable through Cloudflare's proxy, which keeps certificates here from being issued.";
  }
  if (wildcard === "unknown") {
    return "We couldn't check DNS from this server, so we can't say yet whether these addresses resolve.";
  }
  return publishing.certificate === "lets-encrypt"
    ? "Not reachable until the wildcard record below points here."
    : "Not reachable until the DNS records below are in place. Self-signed certificate until then.";
}

/** The suffix a domain typed into the field would publish under. */
export function previewSuffix(input: { typed: string; serverIp: string | null }): string {
  const typed = input.typed.trim().toLowerCase();
  // An emptied field falls back the way the resolver does: sslip.io on this
  // server's IP, loopback when the IP isn't known.
  return typed || `${input.serverIp ?? "127.0.0.1"}.sslip.io`;
}

/** A warning under the records, for the states that need the operator to act
 *  on something the status pill can't fit. */
export function wildcardWarning(input: {
  baseDomain: string;
  serverIp: string | null;
  check: { state: WildcardState; addresses: string[]; proxied: boolean };
}): string | null {
  const name = `*.${input.baseDomain}`;
  const { check } = input;
  if (check.state !== "pointing-elsewhere") return null;
  if (check.proxied) {
    return `${name} is proxied by Cloudflare. Turn the proxy off (grey cloud) for this record: the proxy answers certificate challenges itself, so certificates here can't be issued.`;
  }
  const target = check.addresses.join(", ");
  return input.serverIp
    ? `${name} resolves to ${target}, not this server (${input.serverIp}). Update the A record, or remove the old one.`
    : `${name} resolves to ${target}.`;
}
