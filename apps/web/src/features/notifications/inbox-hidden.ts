/**
 * Snoozed and dismissed conditions, per browser.
 *
 * A dismissal is an opinion about a condition AS IT IS NOW: "I know, stop
 * showing me." It is keyed on the condition and pinned to its newest
 * occurrence, so a new occurrence — the box that was at 92% memory is now at
 * 99% — brings the card back on its own. A snooze is the same with an expiry.
 *
 * Local storage rather than a server column, deliberately: the server's job
 * is to say what is true; whether one person wants to look at it today is
 * theirs, and it should not follow them to a teammate's screen.
 */
import { Result } from "better-result";
import * as z from "zod";

const entrySchema = z.object({
  /** Epoch ms the snooze ends, or null for a dismissal. */
  until: z.number().nullable(),
  /** The newest occurrence id at the time; a newer one voids the entry. */
  latestId: z.string(),
});
const hiddenSchema = z.record(z.string(), entrySchema);

export type HiddenConditions = z.infer<typeof hiddenSchema>;

const storageKey = (orgSlug: string) => `otterdeploy.inbox.hidden:${orgSlug}`;

export function readHidden(orgSlug: string): HiddenConditions {
  const parsed = Result.try({
    try: () => {
      const raw = localStorage.getItem(storageKey(orgSlug));
      return raw === null ? {} : hiddenSchema.parse(JSON.parse(raw));
    },
    catch: () => undefined,
  });
  return parsed.isOk() ? parsed.value : {};
}

export function writeHidden(orgSlug: string, hidden: HiddenConditions): void {
  void Result.try({
    try: () => localStorage.setItem(storageKey(orgSlug), JSON.stringify(hidden)),
    catch: () => undefined,
  });
}

interface ConditionRef {
  key: string;
  occurrenceIds: readonly string[];
}

export function isHidden(hidden: HiddenConditions, condition: ConditionRef, now: number): boolean {
  const entry = hidden[condition.key];
  if (!entry) return false;
  if (entry.latestId !== condition.occurrenceIds[0]) return false;
  return entry.until === null || entry.until > now;
}

/** A new map with `condition` hidden; `until` null means "until it changes". */
export function withHidden(
  hidden: HiddenConditions,
  condition: ConditionRef,
  until: number | null,
): HiddenConditions {
  const latestId = condition.occurrenceIds[0];
  if (latestId === undefined) return hidden;
  return { ...hidden, [condition.key]: { until, latestId } };
}

/** Drop entries whose snooze has lapsed, so the map does not grow forever. */
export function pruneHidden(hidden: HiddenConditions, now: number): HiddenConditions {
  return Object.fromEntries(
    Object.entries(hidden).filter(([, entry]) => entry.until === null || entry.until > now),
  );
}
