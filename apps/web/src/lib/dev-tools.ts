/**
 * Opt-in loader for react-scan (component-render overlay + FPS toolbar).
 *
 * Previously loaded unconditionally from a <script> tag in index.html, which
 * meant every dev-server session got the overlay + toolbar on top of the app
 * (and its outdated-version console warnings) whether anyone wanted it or
 * not. It also visually collided with our own toast stack.
 *
 * Now: dev-only (this whole call is dead-code-eliminated from prod builds
 * because `import.meta.env.DEV` is statically replaced by Vite) AND
 * opt-in: set `localStorage.setItem("otterdeploy:react-scan", "1")` or
 * launch the dev server with `VITE_REACT_SCAN=1` to enable it.
 */
export function installReactScanIfEnabled(): void {
  if (!import.meta.env.DEV) return;

  const flagFromEnv = import.meta.env.VITE_REACT_SCAN === "1";
  const flagFromStorage = (() => {
    try {
      return localStorage.getItem("otterdeploy:react-scan") === "1";
    } catch {
      return false;
    }
  })();

  if (!flagFromEnv && !flagFromStorage) return;

  const script = document.createElement("script");
  script.src = "//unpkg.com/react-scan/dist/auto.global.js";
  script.crossOrigin = "anonymous";
  document.head.appendChild(script);
}
