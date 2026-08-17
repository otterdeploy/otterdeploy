/**
 * Re-exported from ../../lib/egress-denylist: the control-plane-identity
 * denylist is shared by every outbound-egress caller (blocklist sync,
 * webhook delivery, notification channels, registry probes, git provider
 * calls), not just the firewall blocklist sync that originally owned it.
 * Kept here under its original name/path so existing imports/mocks don't
 * need to change.
 */
export { controlPlaneEgressDenylist as blocklistEgressDenylist } from "../../lib/egress-denylist";
