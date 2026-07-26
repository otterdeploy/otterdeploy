/**
 * Shared "pin on first contact" step for SSH host-key fingerprints
 * (od-5j8.19). Called right after every successful `SshSession.connect()` in
 * both the initial provisioning path (provision-runner.ts) and the
 * reprovision/firewall-remediation path (firewall-remediation.ts) — split out
 * here (rather than living in either) because provision-runner.ts already
 * imports firewall-remediation.ts for `runFirewallOnlyJob`, and the reverse
 * import would be a cycle.
 */
import type { OrganizationId, ServerId } from "@otterdeploy/shared/id";

import { log } from "evlog";

import { patchServerHostFingerprint } from "./queries";
import type { SshSession } from "./ssh-exec";

export interface PinHostFingerprintInput {
  serverId: ServerId;
  organizationId: OrganizationId;
  session: SshSession;
  /** True when the server row already carried a pin BEFORE this connect —
   *  meaning `session.hostFingerprint` was already verified against it by
   *  ssh-exec.ts's hostVerifier (a mismatch would have thrown before we ever
   *  get here). Nothing to persist; the pin doesn't change. */
  alreadyPinned: boolean;
  /** True when the operator supplied the expected fingerprint up front (and
   *  it was therefore actually verified, not merely trusted, on this
   *  connect) — the pin is recorded as operator-verified from birth instead
   *  of "accepted on trust". */
  operatorVerified: boolean;
  emit: (line: string) => void;
}

/**
 * First-contact pin: persist the fingerprint `SshSession.connect()` observed
 * and narrate the trust posture to the operator. No-op once a pin already
 * exists (the connect already enforced it — see ssh-exec.ts). This is also
 * the auto-migration path for servers provisioned before od-5j8.19 shipped
 * (hostFingerprint is null on every pre-existing row): their next successful
 * reconnect (reprovision or firewall remediation) pins going forward,
 * without ever locking the operator out of an already-enrolled fleet.
 */
export async function pinHostFingerprintOnFirstContact(input: PinHostFingerprintInput): Promise<void> {
  if (input.alreadyPinned) return;
  await patchServerHostFingerprint({
    serverId: input.serverId,
    organizationId: input.organizationId,
    hostFingerprint: input.session.hostFingerprint,
    hostFingerprintVerified: input.operatorVerified,
    hostFingerprintAlgo: "sha256",
  });
  if (input.operatorVerified) {
    input.emit(`✓ host key verified against the fingerprint you provided (${input.session.hostFingerprint})`);
  } else {
    input.emit(
      `⚠ host key accepted on trust and pinned: ${input.session.hostFingerprint} — verify this out-of-band ` +
        `(your VPS provider's console, ssh-keyscan from a trusted network) and confirm it via ` +
        `server.confirmHostFingerprint. Every connection to this host from now on must present this exact key.`,
    );
  }
  log.warn({
    server: {
      event: "ssh-host-key-pinned",
      serverId: input.serverId,
      organizationId: input.organizationId,
      fingerprint: input.session.hostFingerprint,
      operatorVerified: input.operatorVerified,
    },
  });
}
