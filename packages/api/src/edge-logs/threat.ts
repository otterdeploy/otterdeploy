/**
 * Scanner-probe classification for edge access logs. A deliberately small,
 * high-signal rule set (same ethos as the audit-anomaly detector): each pattern
 * targets a path real clients never request but vulnerability scanners hammer —
 * secret files, framework debug endpoints, PHP/CGI probes, command injection.
 *
 * The pattern BODIES are shared two ways so the badge in the UI, the "suspicious"
 * filter, the Firewall "flagged IPs" panel, and the anomaly scan all agree:
 *   - `classifyThreat` compiles them to a JS RegExp (per-row category label);
 *   - `THREAT_SQL_REGEX` joins them for Postgres `~*` (set-level filtering).
 * They stay in lockstep because the constructs used (char classes, `\.`,
 * alternation, `$`, `?`) mean the same thing in JS regex and Postgres ARE — we
 * avoid `\b` (which Postgres spells `\y`) on purpose.
 *
 * NOTE: `apps/web/src/features/edge-logs/threat.ts` mirrors `classifyThreat` for
 * the client badge/filter — keep the two in sync (like the notifications event
 * catalog). The SQL regex is server-only.
 */

/** ordered, most-specific first; the first body that matches wins the label. */
const THREAT_RULES: ReadonlyArray<readonly [category: string, body: string]> = [
  // Dotfiles that leak secrets/source: /.env, /.git/config, /.aws/credentials …
  // (NOT /.well-known/* — legit, and absent from this list.)
  ["secret-file", "/\\.(env|git|aws|ssh|svn|hg|npmrc|htpasswd|bash_history|dockercfg)([/.]|$)"],
  // Editor/IDE config: /.vscode/sftp.json, /.idea/…
  ["ide-config", "/\\.(vscode|idea)(/|$)"],
  ["php-probe", "\\.php([/?]|$)"],
  ["script-probe", "\\.(asp|aspx|jsp|jspx|cgi|axd)([/?]|$)"],
  // Executables never served to a browser — /php-cgi/php-cgi.exe, *.dll (RCE probes).
  ["exe-probe", "\\.(exe|dll)([/?]|$)"],
  ["cgi-probe", "/cgi-bin/"],
  // App/framework internals: /actuator/env, /telescope/requests, /wp-login.php …
  [
    "framework-probe",
    "/(actuator|telescope|_profiler|server-status|server-info|xmlrpc|phpmyadmin|adminer|wp-admin|wp-login|wp-includes|wp-content|wp-config)([/?.]|$)",
  ],
  ["debug-probe", "/(debug|_debugbar|nodesync)([/?]|$)"],
  // Command execution via query string: ?cmd=hostname, ?exec=…
  ["cmd-injection", "[?&](cmd|exec|command|call)="],
  [
    "config-file",
    "/(config|configuration|credentials|secrets|settings)\\.(json|ya?ml|xml|php|ini|env)([/?]|$)",
  ],
  ["archive-probe", "/(META-INF|WEB-INF)/"],
  ["vite-env", "/@vite/env([/?]|$)"],
];

const COMPILED: ReadonlyArray<readonly [string, RegExp]> = THREAT_RULES.map(
  ([category, body]) => [category, new RegExp(body, "i")] as const,
);

/** A single Postgres `~*` regex matching ANY threat rule — for set-level SQL
 *  filtering (suspicious filter, flagged-IP aggregation, anomaly scan). */
export const THREAT_SQL_REGEX = THREAT_RULES.map(([, body]) => `(${body})`).join("|");

/**
 * Classify a request path (query string included, as stored on the row) as a
 * scanner probe. Returns the category label of the first matching rule, or null
 * for ordinary traffic. Legit paths (`/`, `/api/*`, assets, `/.well-known/*`)
 * match nothing.
 */
export function classifyThreat(path: string): string | null {
  for (const [category, re] of COMPILED) {
    if (re.test(path)) return category;
  }
  return null;
}

/** Boolean convenience over {@link classifyThreat}. */
export function isSuspiciousPath(path: string): boolean {
  return classifyThreat(path) !== null;
}
