/**
 * The colour of the self-signed certificate state, shared by every surface
 * that shows it (the Self-signed chip, the Networking table's TLS cell, the
 * probe status on Edge → Certificates and the route detail panel) so one fact
 * never reads as two signals.
 *
 * Info, not warning. A self-signed certificate on a generated address is the
 * expected state of a fresh install, not something degraded or pending:
 * DESIGN.md keeps warning for pending/degraded/attention-needed and info for
 * neutral facts the operator should know. The word "Self-signed" carries the
 * state; the tint only groups it.
 */
export const SELF_SIGNED_TONE = {
  chip: "border-info/30 bg-info/10 text-info",
  dot: "bg-info",
  text: "text-info",
} as const;
