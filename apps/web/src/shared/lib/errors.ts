/**
 * Turn an unknown thrown value into a short, user-safe string for a toast.
 *
 * Server-side ORM/DB failures reach the client as an opaque SQL dump —
 * Drizzle wraps postgres-js errors with the failing statement as the message
 * ("Failed query: insert into … params: <every bind value>"). That is useless
 * to a user and, uncapped, floods the screen. When we detect that shape we
 * drop it for the caller's fallback; otherwise we return the message with
 * whitespace collapsed and a hard length cap so a single toast can never run
 * away. (The Toaster also clamps height in CSS — this keeps the *content*
 * clean; the CSS is the last-resort cap for messages that don't come through
 * here.)
 */
const MAX_TOAST_MESSAGE = 200;

const looksLikeRawDbError = (m: string): boolean =>
  /failed query:|(?:^|\s)(?:insert into|select |update |delete from)\b|\bparams:/i.test(m);

export function toastMessage(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const msg = raw.replace(/\s+/g, " ").trim();
  if (!msg || looksLikeRawDbError(msg)) return fallback;
  return msg.length > MAX_TOAST_MESSAGE ? `${msg.slice(0, MAX_TOAST_MESSAGE - 1).trimEnd()}…` : msg;
}
