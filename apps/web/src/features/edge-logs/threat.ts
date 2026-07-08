/**
 * Scanner-probe classification for edge access logs — client mirror of
 * `packages/api/src/edge-logs/threat.ts`. Powers the per-row "suspicious" badge
 * and the "Suspicious" toolbar filter. Keep the rule bodies in lockstep with the
 * server copy (same convention as the notifications event catalog). The SQL
 * regex lives server-side only.
 */

/** ordered, most-specific first; the first body that matches wins the label. */
const THREAT_RULES: ReadonlyArray<readonly [category: string, body: string]> = [
  ["secret-file", "/\\.(env|git|aws|ssh|svn|hg|npmrc|htpasswd|bash_history|dockercfg)([/.]|$)"],
  ["ide-config", "/\\.(vscode|idea)(/|$)"],
  ["php-probe", "\\.php([/?]|$)"],
  ["script-probe", "\\.(asp|aspx|jsp|jspx|cgi|axd)([/?]|$)"],
  ["exe-probe", "\\.(exe|dll)([/?]|$)"],
  ["cgi-probe", "/cgi-bin/"],
  [
    "framework-probe",
    "/(actuator|telescope|_profiler|server-status|server-info|xmlrpc|phpmyadmin|adminer|wp-admin|wp-login|wp-includes|wp-content|wp-config)([/?.]|$)",
  ],
  ["debug-probe", "/(debug|_debugbar|nodesync)([/?]|$)"],
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

/** Category label of the first matching probe rule, or null for ordinary traffic. */
export function classifyThreat(path: string): string | null {
  for (const [category, re] of COMPILED) {
    if (re.test(path)) return category;
  }
  return null;
}
