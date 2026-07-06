/**
 * AccessWall CSS — base half (root vars, body, full-page grid/glow backdrop,
 * topbar wordmark, domain pill). Concatenated with `accessWallFormCss` to form
 * the full stylesheet; split only to keep each module under the line cap.
 * NOTE: no trailing newline — the closing backtick hugs the last rule so the
 * join is byte-exact.
 */

export const accessWallBaseCss = `
      * {
        box-sizing: border-box;
      }
      :root {
        --bg: #0c0c0b;
        --fg: #f5f5f0;
        --fg-muted: #7a7a72;
        --fg-subtle: #3a3a36;
        --border: rgba(255, 255, 250, 0.08);
        --border-mid: rgba(255, 255, 250, 0.13);
        --primary: oklch(0.623 0.214 300);
        --primary-dim: oklch(0.623 0.214 300 / 0.15);
        --line: rgba(255, 255, 250, 0.04);
        --radius: 10px;
        --input-bg: rgba(255, 255, 250, 0.05);
      }
      html,
      body {
        height: 100%;
        margin: 0;
        overscroll-behavior: none;
      }
      body {
        font-family: "Geist Variable", ui-sans-serif, system-ui, sans-serif;
        font-size: 14px;
        letter-spacing: -0.005em;
        -webkit-font-smoothing: antialiased;
        background: var(--bg);
        color: var(--fg);
        height: 100vh;
        overflow: hidden;
      }
      .bg-grid {
        position: fixed;
        inset: 0;
        pointer-events: none;
        background-image:
          linear-gradient(var(--line) 1px, transparent 1px),
          linear-gradient(90deg, var(--line) 1px, transparent 1px);
        background-size: 64px 64px;
      }
      .bg-glow {
        position: fixed;
        inset: 0;
        pointer-events: none;
        background: radial-gradient(
          60rem 50rem at 50% 45%,
          oklch(0.623 0.214 300 / 0.07),
          transparent 65%
        );
      }
      .topbar {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        padding: 28px 36px;
        z-index: 1;
      }
      .wordmark {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .wordmark svg {
        width: 20px;
        height: 20px;
        color: var(--primary);
      }
      .wordmark-name {
        font-size: 13px;
        font-weight: 600;
        letter-spacing: -0.02em;
        color: var(--fg);
      }
      .card-eyebrow {
        font-family: "Geist Mono Variable", ui-monospace, monospace;
        font-size: 10px;
        letter-spacing: 0.1em;
        color: var(--fg-muted);
        text-transform: uppercase;
        margin-bottom: 14px;
      }
      .domain-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        background: var(--input-bg);
        border: 1px solid var(--border-mid);
        border-radius: 8px;
        font-family: "Geist Mono Variable", ui-monospace, monospace;
        font-size: 12px;
        color: var(--fg);
        font-feature-settings: "zero", "ss03";
        margin-bottom: 28px;
      }
      .domain-pill svg {
        width: 15px;
        height: 15px;
        color: var(--primary);
        flex-shrink: 0;
      }
      .domain-cursor {
        display: inline-block;
        width: 1.5px;
        height: 12px;
        background: var(--primary);
        margin-left: 1px;
        vertical-align: middle;
        animation: blink 0.9s step-end infinite;
      }
      @keyframes blink {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0;
        }
      }`;
