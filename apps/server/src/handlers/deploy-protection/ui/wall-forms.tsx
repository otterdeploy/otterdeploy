/**
 * The two auth paths the wall can offer: the PIN form (for routes with a PIN
 * configured) and the org/email pair (for routes without). Split from wall.tsx
 * purely to keep that file under the line cap — these are markup only; the
 * submit handlers live in the wall's inline script.
 */

import type { FC } from "hono/jsx";

/** PIN-only card body: the route has a PIN configured, so the PIN is the ONE
 *  way in — no auth alternatives are offered beside it. */
export const PinAuth: FC = () => (
  <form id="pinForm">
    <label class="field-label" for="pin">
      Access PIN
    </label>
    <input
      class="email-input"
      id="pin"
      inputmode="numeric"
      pattern="[0-9]*"
      maxlength={8}
      placeholder="Enter PIN"
      autocomplete="off"
      autofocus
    />
    <button class="btn-primary" type="submit">
      Unlock
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 9.9-1" />
      </svg>
    </button>
  </form>
);

/** No-PIN card body: org handoff button + the two-step email/code form. */
export const OrgEmailAuth: FC<{ orgAuthorizeUrl: string }> = ({ orgAuthorizeUrl }) => (
  <>
    <a class="btn-org" href={orgAuthorizeUrl}>
      <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <rect
          x="4.6"
          y="4.6"
          width="22.8"
          height="22.8"
          rx="7.1"
          stroke="currentColor"
          stroke-width="2.6"
        />
        <path
          d="M10.6 21.4 21.4 10.6"
          stroke="var(--primary)"
          stroke-width="2.6"
          stroke-linecap="round"
        />
      </svg>
      Continue with your organization
    </a>

    <div class="or-row">
      <div class="or-line" />
      <span class="or-text">or</span>
      <div class="or-line" />
    </div>

    <form id="emailForm">
      <label class="field-label" for="email">
        Work email
      </label>
      <input
        class="email-input"
        id="email"
        type="email"
        placeholder="you@example.com"
        autocomplete="email"
        required
      />
      <button class="btn-primary" type="submit">
        Email me a code
      </button>
    </form>

    <form id="codeForm" class="hide">
      <label class="field-label" for="code">
        Verification code
      </label>
      <input
        class="email-input"
        id="code"
        inputmode="numeric"
        pattern="[0-9]*"
        maxlength={6}
        placeholder="6-digit code"
        autocomplete="one-time-code"
      />
      <button class="btn-primary" type="submit">
        Verify
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M5 12h14" />
          <path d="m12 5 7 7-7 7" />
        </svg>
      </button>
    </form>
  </>
);
