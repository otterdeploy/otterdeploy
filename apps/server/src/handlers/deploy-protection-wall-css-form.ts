/**
 * AccessWall CSS — form half (right auth column, inputs, buttons, footer,
 * responsive). Concatenated after `accessWallBaseCss`. Extracted verbatim.
 */

export const accessWallFormCss = `
      .right {
        width: 420px;
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        justify-content: center;
        padding: 60px 48px 96px;
        overflow-y: auto;
        animation: rise 0.5s cubic-bezier(0.2, 0.7, 0.2, 1) both;
      }
      @keyframes rise {
        from {
          opacity: 0;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          transform: none;
        }
      }
      .form-head {
        margin-bottom: 32px;
      }
      .form-title {
        font-size: 20px;
        font-weight: 600;
        letter-spacing: -0.03em;
        color: var(--fg);
        margin-bottom: 6px;
      }
      .form-sub {
        font-size: 13px;
        color: var(--fg-muted);
        letter-spacing: -0.01em;
      }
      .btn-org {
        width: 100%;
        padding: 11px 16px;
        border-radius: var(--radius);
        border: 1px solid var(--border-mid);
        background: var(--input-bg);
        color: var(--fg);
        font-family: inherit;
        font-size: 13px;
        font-weight: 500;
        letter-spacing: -0.01em;
        cursor: pointer;
        text-decoration: none;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 9px;
        transition:
          background 0.12s,
          border-color 0.12s;
        margin-bottom: 20px;
      }
      .btn-org:hover {
        background: rgba(255, 255, 250, 0.09);
        border-color: rgba(255, 255, 250, 0.2);
      }
      .btn-org svg {
        width: 18px;
        height: 18px;
        color: var(--fg-muted);
      }
      .or-row {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 20px;
      }
      .or-line {
        flex: 1;
        height: 1px;
        background: var(--border);
      }
      .or-text {
        font-family: "Geist Mono Variable", ui-monospace, monospace;
        font-size: 10px;
        letter-spacing: 0.1em;
        color: var(--fg-muted);
        text-transform: uppercase;
      }
      .field-label {
        display: block;
        font-size: 11px;
        font-weight: 500;
        color: var(--fg-muted);
        letter-spacing: 0.04em;
        margin-bottom: 6px;
        text-transform: uppercase;
        font-family: "Geist Mono Variable", ui-monospace, monospace;
      }
      .email-input {
        width: 100%;
        padding: 11px 14px;
        border-radius: var(--radius);
        border: 1px solid var(--border-mid);
        background: var(--input-bg);
        color: var(--fg);
        font-family: inherit;
        font-size: 13px;
        letter-spacing: -0.01em;
        outline: none;
        transition:
          border-color 0.15s,
          background 0.15s;
        margin-bottom: 8px;
      }
      .email-input::placeholder {
        color: var(--fg-subtle);
      }
      .email-input:focus {
        border-color: var(--primary);
        background: var(--primary-dim);
      }
      .btn-primary {
        width: 100%;
        padding: 11px 16px;
        border-radius: var(--radius);
        border: none;
        background: var(--fg);
        color: var(--bg);
        font-family: inherit;
        font-size: 13px;
        font-weight: 600;
        letter-spacing: -0.01em;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        transition: opacity 0.12s;
      }
      .btn-primary:hover {
        opacity: 0.88;
      }
      .btn-primary:active {
        opacity: 0.75;
        transform: scale(0.99);
      }
      .btn-primary svg {
        width: 16px;
        height: 16px;
      }
      .msg {
        font-size: 12px;
        min-height: 16px;
        margin-top: 12px;
      }
      .msg.err {
        color: #f87171;
      }
      .msg.ok {
        color: #4ade80;
      }
      .hide {
        display: none;
      }
      .form-footer {
        margin-top: 24px;
        font-size: 11px;
        color: var(--fg-subtle);
        line-height: 1.6;
      }
      .form-footer a {
        color: var(--fg-muted);
        text-decoration: none;
        border-bottom: 1px solid var(--border-mid);
        padding-bottom: 1px;
        transition: color 0.12s;
      }
      .form-footer a:hover {
        color: var(--fg);
      }
      .page-footer {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        border-top: 1px solid var(--border);
        padding: 16px 64px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: var(--bg);
        font-family: "Geist Mono Variable", ui-monospace, monospace;
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.16em;
        color: var(--fg-muted);
      }
      .pf-accent {
        color: var(--primary);
      }
      @media (prefers-reduced-motion: reduce) {
        .right,
        .domain-cursor {
          animation: none;
        }
      }
      @media (max-width: 700px) {
        .left {
          display: none;
        }
        .right {
          width: 100%;
          padding: 48px 28px;
        }
      }
    `;
