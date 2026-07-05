/**
 * Copy text to the clipboard, working even in an *insecure* context.
 *
 * The async Clipboard API (`navigator.clipboard`) is only exposed in a secure
 * context — HTTPS or `localhost`. A self-hosted otterdeploy reached over plain
 * HTTP by IP/LAN (e.g. `http://10.0.0.5:3000`) has `navigator.clipboard`
 * undefined, so every copy button silently failed (guarded `?.` calls no-op'd;
 * unguarded ones threw). This helper tries the modern API first, then falls
 * back to a hidden-textarea + `document.execCommand("copy")`, which works
 * without a secure context.
 *
 * Returns whether the copy succeeded so callers can toast accordingly.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Secure context (HTTPS/localhost): prefer the async Clipboard API.
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied, document not focused, etc. — try the legacy path.
    }
  }

  // Legacy fallback: a throwaway textarea + execCommand. Deprecated but the
  // only clipboard write available over plain HTTP.
  if (typeof document === "undefined") return false;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  // Keep it out of view and non-interactive, but selectable.
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  try {
    textarea.focus();
    textarea.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}
