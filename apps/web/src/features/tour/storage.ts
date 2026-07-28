/**
 * Seen-state for the product tour — an `otterdeploy:`-prefixed localStorage
 * record (the same convention as `lib/dev-tools.ts`). No server round-trip:
 * whether someone has watched a walkthrough is device-level UI state, like
 * theme or sidebar width, not account data.
 */

const STORAGE_KEY = "otterdeploy:tour:v1";

interface TourRecord {
  /** Set when the user reached the final step and clicked Done. */
  completedAt?: string;
  /** Set when the user closed the tour early (Esc, ×, overlay). */
  dismissedAt?: string;
  /** Step index the user was on when they dismissed — for a future resume. */
  lastStep?: number;
}

function read(): TourRecord {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as TourRecord;
  } catch {
    return {};
  }
}

function write(record: TourRecord): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Storage full or blocked — the tour will simply offer itself again.
  }
}

/** True once the tour was either finished or explicitly closed. */
export function hasSeenTour(): boolean {
  const record = read();
  return record.completedAt !== undefined || record.dismissedAt !== undefined;
}

export function markTourCompleted(): void {
  write({ ...read(), completedAt: new Date().toISOString() });
}

export function markTourDismissed(lastStep: number): void {
  const record = read();
  // A completed tour stays completed — a later replay closed early
  // shouldn't downgrade the record.
  if (record.completedAt !== undefined) return;
  write({ ...record, dismissedAt: new Date().toISOString(), lastStep });
}
