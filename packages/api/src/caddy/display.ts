/**
 * Display-side sanitizers for rendered Caddyfiles. Pure string transforms —
 * the reconciler always works on the full, unsanitized text; only what the
 * dashboard shows passes through here.
 */

/** Strip the leading brace-balanced global-options block from a rendered
 *  Caddyfile. The global block exists so a per-project fragment validates
 *  standalone via `/adapt`, but it is install-wide state (admin bind, edge
 *  log sink, CrowdSec credentials) — never something a project view should
 *  display. */
export function stripGlobalBlock(caddyfile: string): string {
  const lines = caddyfile.split("\n");
  const first = lines.findIndex((l) => l.trim().length > 0);
  if (first === -1 || lines[first]?.trim() !== "{") return caddyfile;
  let depth = 0;
  for (let i = first; i < lines.length; i++) {
    const t = (lines[i] ?? "").trim();
    if (t.endsWith("{")) depth++;
    if (t === "}") {
      depth--;
      if (depth === 0) {
        return lines
          .slice(i + 1)
          .join("\n")
          .replace(/^\n+/, "");
      }
    }
  }
  return caddyfile;
}

/** Mask credential-bearing directive values (CrowdSec `api_key`) in a
 *  Caddyfile rendered for display. Defense in depth — the project view
 *  already strips the global block that carries them. */
export function maskCaddySecrets(caddyfile: string): string {
  return caddyfile.replace(/^(\s*api_key\s+)\S+/gm, "$1••••••••");
}
