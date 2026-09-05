/**
 * Landing-page copy and data.
 *
 * Marketing surface, not documentation. The deep reference lives in /docs.
 * What stays true regardless: nothing here is invented. Counts, engine names
 * and state words are checked against the code, because a self-hoster who
 * reads a claim here and can't find it in the dashboard stops trusting the
 * dashboard too.
 */

export const GITHUB_URL = "https://github.com/otterdeploy/otterdeploy";

/** scripts/install.sh: the host installer, published at get.otterdeploy.com. */
export const INSTALL_CMD = "curl -fsSL https://get.otterdeploy.com/install.sh | bash";

// ── Compare ────────────────────────────────────────────────────────────────

/**
 * The table every visitor was going to build in a second tab anyway.
 *
 * Marks are deliberately generous to the competition: `partial` means the
 * capability exists but needs wiring, plugins or caveats. Anything we are not
 * sure of is marked in the competitor's favour — being caught overclaiming
 * once costs more than every row combined.
 */
export type CompareMark = "yes" | "partial" | "no";

export const COMPARE_COLUMNS = ["otterdeploy", "Coolify", "Dokploy", "CapRover", "Kamal"];

export const COMPARE_ROWS: { label: string; marks: CompareMark[] }[] = [
  { label: "Web dashboard", marks: ["yes", "yes", "yes", "yes", "no"] },
  { label: "Preview deployments per PR", marks: ["yes", "yes", "yes", "no", "no"] },
  { label: "PostgreSQL branching for previews", marks: ["yes", "no", "no", "no", "no"] },
  { label: "Managed databases", marks: ["yes", "yes", "yes", "partial", "partial"] },
  { label: "Encrypted, scheduled backups", marks: ["yes", "partial", "partial", "partial", "no"] },
  { label: "Start-first rolling updates", marks: ["yes", "partial", "partial", "partial", "yes"] },
  { label: "Multi-node scheduling", marks: ["yes", "partial", "yes", "yes", "partial"] },
  { label: "Compose stacks as one resource", marks: ["yes", "yes", "yes", "partial", "no"] },
  { label: "Typed API + CLI", marks: ["yes", "partial", "partial", "partial", "partial"] },
  { label: "Automated node mesh join (Tailscale/NetBird)", marks: ["yes", "no", "no", "no", "no"] },
  { label: "Host firewall + CrowdSec by default", marks: ["yes", "no", "no", "no", "no"] },
];

// ── FAQ ────────────────────────────────────────────────────────────────────

/**
 * Straight answers, including the uncomfortable ones. Every answer restates
 * something already true elsewhere on this page or in the docs — the FAQ is
 * where a visitor checks whether the marketing was honest.
 */
export const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: "Is it production-ready?",
    a: "Not yet. otterdeploy is pre-1.0 and under active development: interfaces and schemas still change without migration paths. Run it on something you'd be willing to rebuild (side projects, staging, internal tools) and hold the production workloads until 1.0.",
  },
  {
    q: "What does it cost?",
    a: "Nothing. It's AGPL-3.0 open source with no tiers, no seats, no usage bill and no hosted upsell hiding features. You pay for your own hardware, which is the point.",
  },
  {
    q: "How is this different from Coolify or Dokploy?",
    a: "Same family, different bets. We bet on previews with PostgreSQL branching, a typed API and CLI for automation, automated node mesh join, and host security (firewall, CrowdSec) on by default rather than as homework. If another tool fits you better, use it; the comparison table above concedes their wins on purpose.",
  },
  {
    q: "Do I need Kubernetes?",
    a: "No. The installer puts Docker into Swarm mode and that's the whole orchestrator. One binary surface to learn, and multi-node when you need it by joining another box.",
  },
  {
    q: "What do I need to start?",
    a: "One supported Linux box with root or passwordless sudo: Debian/Ubuntu, a RHEL/Fedora-family distro, or Arch. Docker 28+ can already be present or the installer can add it. Ports 80 and 443 must be reachable for the edge and ACME, and the dashboard port (3000 by default) must be free.",
  },
  {
    q: "What happens when the box dies?",
    a: "A single machine is a single point of failure. Configure scheduled backups to an external destination before you depend on recovery: the managed local destination lives on that same node and does not survive its loss. Multi-node Swarm improves service availability but does not replace off-node backups.",
  },
];
