import { relativeMs } from "@/shared/lib/time";

/**
 * Color family for an action's leading dot, keyed off the action's verb.
 * Actions are RPC paths (`<resource>.<verb>`, e.g. "projects.create",
 * "servers.setAvailability"), so the verb is the last dot-segment.
 *
 * Families follow the demo's ACTION_COLORS intent: creations read as info,
 * destructive verbs as danger, plain edits stay neutral, auth and
 * state-rewinding verbs (rollback/restore/pause) get caution amber.
 */
export type ActionTone = "create" | "destroy" | "update" | "auth" | "caution" | "neutral";

const TONE_VERBS: Array<[ActionTone, RegExp]> = [
  ["destroy", /^(delete|remove|revoke|destroy|disconnect|uninstall|teardown|purge|block|deny)/],
  // `rotate` rides with create, it mints a new credential (demo colors it info).
  ["create", /^(create|add|register|generate|connect|install|invite|grant|enable|import|upload|rotate)/],
  ["caution", /^(rollback|restore|pause|resume|redeploy|retry|recheck|cancel|stop|drain)/],
  ["auth", /^(login|logout|sign[-]?in|sign[-]?out|mfa|session|verify|impersonate|auth)/],
  ["update", /^(update|set|rename|edit|change|toggle|save|configure|move|reorder|assign|transfer)/],
];

export function actionTone(action: string): ActionTone {
  const verb = (action.split(".").pop() ?? action).toLowerCase();
  // Auth-plane actions carry the family in the resource segment ("auth.…",
  // "session.…") even when the verb itself is generic.
  if (/^(auth|session|mfa|login)\b/.test(action.toLowerCase())) return "auth";
  for (const [tone, re] of TONE_VERBS) if (re.test(verb)) return tone;
  return "neutral";
}

/** An audit row's timestamp. The em dash is this surface's own sentinel for
 *  an unparseable one; the formatting itself is shared. */
export function timeAgoOrDash(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "–" : relativeMs(t);
}
