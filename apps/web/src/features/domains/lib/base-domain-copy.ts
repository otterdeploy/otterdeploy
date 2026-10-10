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
  onServerIp: boolean;
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

/** What follows `<service>-<project>.` With `onServerIp`, the server's
 *  (masked) address goes in front of `suffix`: the IP is never in the text. */
export interface PublishSuffix {
  suffix: string;
  onServerIp: boolean;
}

/** The suffix a domain typed into the field would publish under. */
export function previewSuffix(input: { typed: string; hasServerIp: boolean }): PublishSuffix {
  const typed = input.typed.trim().toLowerCase();
  if (typed) return { suffix: typed, onServerIp: false };
  // An emptied field falls back the way the resolver does: sslip.io on this
  // server's IP, loopback when the IP isn't known.
  return input.hasServerIp
    ? { suffix: "sslip.io", onServerIp: true }
    : { suffix: "127.0.0.1.sslip.io", onServerIp: false };
}

/** A warning under the records, for the states that need the operator to act
 *  on something the status pill can't fit. Never names this server's address:
 *  the page shows it masked, and only to installation admins. */
export function wildcardWarning(input: {
  baseDomain: string;
  check: { state: WildcardState; addresses: string[]; proxied: boolean };
}): string | null {
  const name = `*.${input.baseDomain}`;
  const { check } = input;
  if (check.state !== "pointing-elsewhere") return null;
  if (check.proxied) {
    return `${name} is proxied by Cloudflare. Turn the proxy off (grey cloud) for this record: the proxy answers certificate challenges itself, so certificates here can't be issued.`;
  }
  const target = check.addresses.join(", ") || "another host";
  return `${name} resolves to ${target}, not this server. Update that record at your DNS provider, or remove it: Write DNS records never overwrites an existing record.`;
}

/** Where the bare domain points, when that is somewhere else. Not a fault:
 *  services only use the wildcard, and one-click leaves the apex alone. */
export function apexNote(input: {
  baseDomain: string;
  apex: { state: WildcardState; addresses: string[]; proxied: boolean } | null;
}): string | null {
  const { apex } = input;
  if (apex?.state !== "pointing-elsewhere") return null;
  const target = apex.proxied ? "Cloudflare's proxy" : apex.addresses.join(", ") || "another host";
  return `${input.baseDomain} itself points to ${target}. That's fine: services use the wildcard, and Write DNS records leaves an existing record alone.`;
}

export type WriteOutcome = "created" | "present" | "elsewhere";

/** The toast after one-click: what it wrote, and what it left alone. */
export function writeResultMessage(input: {
  baseDomain: string;
  verified: boolean;
  apex: WriteOutcome;
  wildcard: WriteOutcome;
}): { tone: "success" | "warning"; text: string } {
  if (input.wildcard === "elsewhere") {
    return {
      tone: "warning",
      text: `*.${input.baseDomain} already points somewhere else, so it was left as it is. Services won't be reachable until it points here.`,
    };
  }
  const left =
    input.apex === "elsewhere"
      ? ` ${input.baseDomain} itself already points elsewhere; left as it is.`
      : "";
  return {
    tone: "success",
    text: input.verified
      ? `DNS records written and the domain is verified.${left}`
      : `DNS records written. Check DNS again in a minute, once they've propagated.${left}`,
  };
}
