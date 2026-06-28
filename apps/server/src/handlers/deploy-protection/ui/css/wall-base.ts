/**
 * AccessWall CSS — base half (root vars, body, layout, left brand panel).
 * Concatenated with `accessWallFormCss` to form the full stylesheet; split only
 * to keep each module under the line cap. Extracted verbatim. NOTE: no trailing
 * newline — the closing backtick hugs the last rule so the join is byte-exact.
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
        display: flex;
      }
      .layout {
        display: flex;
        width: 100%;
        height: 100vh;
      }
      .left {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 48px;
        padding: 56px 64px 72px;
        position: relative;
        border-right: 1px solid var(--border);
        overflow: hidden;
      }
      .left-grid {
        position: absolute;
        inset: 0;
        pointer-events: none;
        background-image:
          linear-gradient(var(--line) 1px, transparent 1px),
          linear-gradient(90deg, var(--line) 1px, transparent 1px);
        background-size: 64px 64px;
      }
      .left-glow {
        position: absolute;
        inset: 0;
        pointer-events: none;
        background: radial-gradient(
          60rem 50rem at 20% 60%,
          oklch(0.623 0.214 300 / 0.08),
          transparent 65%
        );
      }
      .left-top,
      .left-middle {
        position: relative;
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
      .left-eyebrow {
        font-family: "Geist Mono Variable", ui-monospace, monospace;
        font-size: 10px;
        letter-spacing: 0.1em;
        color: var(--fg-muted);
        text-transform: uppercase;
        margin-bottom: 24px;
      }
      .left-headline {
        font-size: 30px;
        font-weight: 600;
        letter-spacing: -0.04em;
        line-height: 1.3;
        color: var(--fg);
        margin-bottom: 36px;
      }
      .left-headline em {
        font-style: normal;
        color: var(--fg-muted);
        font-weight: 400;
      }
      .domain-label {
        font-family: "Geist Mono Variable", ui-monospace, monospace;
        font-size: 10px;
        color: var(--fg-muted);
        letter-spacing: 0.06em;
        text-transform: uppercase;
        margin-bottom: 6px;
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
