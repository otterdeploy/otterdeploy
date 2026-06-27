/**
 * Console-frame styling for the wall's full-screen status pages (ErrorPage +
 * Interstitial). The web `ErrorScreen` aesthetic ported to server HTML — dark,
 * masked grid, accent glow, grain, corner-tick frame. Caller passes the
 * accent/glow; the static rules live in a module const so the builder stays a
 * short function. Extracted verbatim from deploy-protection.tsx.
 */

const CONSOLE_FRAME_STATIC = `
  * {
    box-sizing: border-box;
  }
  html,
  body {
    height: 100%;
    margin: 0;
  }
  body {
    position: relative;
    overflow: hidden;
    background: var(--bg);
    color: var(--ink);
    font-family: ui-monospace, SFMono-Regular, Menlo, "Geist Mono Variable",
      monospace;
    font-size: clamp(13px, 1.4vmin, 17px);
    -webkit-font-smoothing: antialiased;
  }
  .layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .grid {
    z-index: 0;
    background-image:
      linear-gradient(var(--line) 1px, transparent 1px),
      linear-gradient(90deg, var(--line) 1px, transparent 1px);
    background-size: 72px 72px;
    -webkit-mask-image: radial-gradient(
      ellipse 72% 72% at 50% 50%,
      #000 32%,
      transparent 90%
    );
    mask-image: radial-gradient(
      ellipse 72% 72% at 50% 50%,
      #000 32%,
      transparent 90%
    );
  }
  .glow {
    z-index: 0;
    background: radial-gradient(
      36rem 26rem at 50% 48%,
      var(--glow),
      transparent 72%
    );
  }
  .grain {
    z-index: 1;
    opacity: 0.04;
    background-image: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='160'%20height='160'%3E%3Cfilter%20id='n'%3E%3CfeTurbulence%20type='fractalNoise'%20baseFrequency='0.82'%20numOctaves='2'%20stitchTiles='stitch'/%3E%3C/filter%3E%3Crect%20width='100%25'%20height='100%25'%20filter='url(%23n)'/%3E%3C/svg%3E");
  }
  .tick {
    position: absolute;
    z-index: 3;
    width: 14px;
    height: 14px;
  }
  .tick.tl {
    top: 14px;
    left: 14px;
    border-top: 1px solid var(--line2);
    border-left: 1px solid var(--line2);
  }
  .tick.tr {
    top: 14px;
    right: 14px;
    border-top: 1px solid var(--line2);
    border-right: 1px solid var(--line2);
  }
  .tick.bl {
    bottom: 14px;
    left: 14px;
    border-bottom: 1px solid var(--line2);
    border-left: 1px solid var(--line2);
  }
  .tick.br {
    bottom: 14px;
    right: 14px;
    border-bottom: 1px solid var(--line2);
    border-right: 1px solid var(--line2);
  }
  .bar {
    position: absolute;
    inset-inline: 0;
    z-index: 3;
    display: flex;
    justify-content: space-between;
    padding: 24px 32px;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    color: var(--dim);
  }
  .bar.top {
    top: 0;
  }
  .bar.bottom {
    bottom: 0;
  }
  .bar b {
    font-weight: 400;
    color: var(--ink);
  }
  .accent {
    color: var(--accent);
  }
  main {
    position: relative;
    z-index: 2;
    display: flex;
    min-height: 100%;
    align-items: center;
    justify-content: center;
    padding: 11vh 8vw;
  }
  .panel {
    width: 100%;
    max-width: 600px;
    text-align: center;
  }
  .eyebrow {
    margin-bottom: 1.7rem;
    font-size: 0.74rem;
    text-transform: uppercase;
    letter-spacing: 0.26em;
    color: var(--accent);
  }
  h1 {
    margin: 1.4rem 0 0;
    font-weight: 700;
    text-transform: uppercase;
    line-height: 1.1;
    letter-spacing: -0.01em;
    font-size: clamp(1.3rem, 2.7vw, 2.05rem);
  }
  .msg {
    margin: 1rem auto 0;
    max-width: 46ch;
    line-height: 1.65;
    color: var(--dim);
    font-size: clamp(0.88rem, 1.15vw, 1.02rem);
  }
  .rise {
    animation: rise 0.6s cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(16px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .rise {
      animation: none;
    }
  }
`;

export const consoleFrameCss = (accent: string, glow: string): string => `
  :root {
    --bg: #0a0b0d;
    --ink: #e7e8ec;
    --dim: #8b8d95;
    --line: rgba(231, 232, 236, 0.07);
    --line2: rgba(231, 232, 236, 0.16);
    --accent: ${accent};
    --glow: ${glow};
  }${CONSOLE_FRAME_STATIC}`;
