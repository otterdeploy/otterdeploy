/**
 * Clipboard writing that works outside secure contexts. `navigator.clipboard`
 * only exists on HTTPS or localhost — a self-hosted dashboard reached over
 * plain `http://<ip-or-host>:<port>` has no async Clipboard API at all, so
 * every `navigator.clipboard?.writeText(...)` call site silently no-oped
 * while still flashing its "Copied" state (same secure-context trap as
 * `crypto.randomUUID`, see lib/random-uuid-polyfill.ts).
 *
 * Strategy: prefer the async API, fall back to the hidden-textarea +
 * `document.execCommand("copy")` trick (deprecated but universally
 * supported, and the only write path in insecure contexts). Resolves to
 * whether the text actually reached the clipboard — call sites must gate
 * their "Copied" feedback on it instead of assuming success.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard) {
    const ok = await navigator.clipboard.writeText(text).then(
      () => true,
      // Rejects on secure origins too (e.g. "Document is not focused" while
      // devtools has focus) — fall through to the legacy path.
      () => false,
    );
    if (ok) return true;
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  // Off-screen but still selectable; `display:none` would make select() a no-op.
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";

  const selection = document.getSelection();
  const prior = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  document.body.appendChild(textarea);
  textarea.select();
  // oxlint-disable-next-line typescript-eslint/no-deprecated -- deprecated, but the only clipboard write available in insecure contexts
  const ok = document.execCommand("copy");
  textarea.remove();

  if (prior) {
    selection?.removeAllRanges();
    selection?.addRange(prior);
  }
  return ok;
}
