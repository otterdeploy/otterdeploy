/**
 * Page-specific CSS appended onto (or used standalone with) the shared console
 * frame: the Interstitial spinner/status-line rules, the Denied page, and the
 * ErrorPage numeral. Extracted verbatim from deploy-protection.tsx.
 */

export const interstitialExtraCss = `
        .spinner {
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--accent);
        }
        .spinner svg {
          width: 52px;
          height: 52px;
          animation: spin 1s linear infinite;
          filter: drop-shadow(0 0 28px var(--glow));
        }
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
        .statusline {
          display: inline-flex;
          align-items: center;
          margin: 1.4rem auto 0;
          min-height: 1.4em;
          color: var(--dim);
          font-size: 0.82rem;
          letter-spacing: 0.04em;
        }
        .cursor {
          display: inline-block;
          width: 7px;
          height: 1.05em;
          margin-left: 4px;
          background: var(--accent);
          vertical-align: text-bottom;
          opacity: 0.75;
          animation: blink 0.85s step-end infinite;
        }
        @keyframes blink {
          0%,
          100% {
            opacity: 0.75;
          }
          50% {
            opacity: 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .spinner svg,
          .cursor {
            animation: none;
          }
        }
      `;

export const deniedCss = `
      html,
      body {
        height: 100%;
        margin: 0;
        background: #000;
        color: #fff;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .wrap {
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 12px;
        text-align: center;
        padding: 0 24px;
      }
      h1 {
        font-size: 24px;
        font-weight: 600;
        margin: 0;
      }
      p {
        color: #999;
        margin: 0;
        max-width: 420px;
      }
      .foot {
        position: fixed;
        bottom: 28px;
        color: #666;
        font-size: 13px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
    `;

export const errorPageExtraCss = `
        .numeral {
          font-weight: 700;
          line-height: 1;
          letter-spacing: -0.04em;
          color: var(--accent);
          font-size: clamp(3.2rem, 9vw, 6rem);
          text-shadow: 0 0 52px var(--glow);
        }
      `;
