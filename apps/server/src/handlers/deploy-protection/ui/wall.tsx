/**
 * The access wall: a single centered card over the full-page grid.
 *
 * PIN-protected routes ask for the PIN and NOTHING else — the PIN takes
 * priority, so the card never offers org/email auth beside it. Routes without
 * a PIN offer org sign-in OR email one-time-code entry (Cloudflare-style,
 * two-step form handled inline). Posts to the OTP/PIN endpoints on this same
 * domain and navigates to `returnPath` on success. Icons are inline SVG (no
 * external icon CDN); accent is purple. Subcomponents exist purely to keep
 * each function under the line cap.
 */

import type { FC } from "hono/jsx";

import { accessWallBaseCss } from "./css/wall-base";
import { accessWallFormCss } from "./css/wall-form";
import { Page } from "./frame";

const Wordmark: FC = () => (
  <div class="wordmark">
    <svg viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <ellipse cx="11" cy="13" rx="7.5" ry="5.5" stroke="currentColor" stroke-width="1.25" />
      <circle cx="7.5" cy="9.5" r="2.8" stroke="currentColor" stroke-width="1.25" />
      <circle cx="14.5" cy="9.5" r="2.8" stroke="currentColor" stroke-width="1.25" />
      <circle cx="7.5" cy="9.5" r="1" fill="currentColor" />
      <circle cx="14.5" cy="9.5" r="1" fill="currentColor" />
      <ellipse cx="11" cy="8" rx="3" ry="2.2" stroke="currentColor" stroke-width="1.25" />
      <path
        d="M3.5 14.5 Q2 16.5 3.5 18"
        stroke="currentColor"
        stroke-width="1.25"
        stroke-linecap="round"
      />
      <path
        d="M18.5 14.5 Q20 16.5 18.5 18"
        stroke="currentColor"
        stroke-width="1.25"
        stroke-linecap="round"
      />
    </svg>
    <span class="wordmark-name">otterdeploy</span>
  </div>
);

const DomainPill: FC<{ domain: string }> = ({ domain }) => (
  <div class="domain-pill">
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    </svg>
    {domain}
    <span class="domain-cursor" />
  </div>
);

/** PIN-only card body: the route has a PIN configured, so the PIN is the ONE
 *  way in — no auth alternatives are offered beside it. */
const PinAuth: FC = () => (
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
const OrgEmailAuth: FC<{ orgAuthorizeUrl: string }> = ({ orgAuthorizeUrl }) => (
  <>
    <a class="btn-org" href={orgAuthorizeUrl}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <rect width="16" height="20" x="4" y="2" rx="2" />
        <path d="M9 22v-4h6v4" />
        <path d="M8 6h.01" />
        <path d="M16 6h.01" />
        <path d="M12 6h.01" />
        <path d="M12 10h.01" />
        <path d="M12 14h.01" />
        <path d="M16 10h.01" />
        <path d="M16 14h.01" />
        <path d="M8 10h.01" />
        <path d="M8 14h.01" />
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

/** The centered auth card: context head + domain pill + the ONE auth path. */
const AccessWallCard: FC<{ domain: string; orgAuthorizeUrl: string; hasPin: boolean }> = ({
  domain,
  orgAuthorizeUrl,
  hasPin,
}) => (
  <div class="card">
    <div class="card-eyebrow">Access request</div>
    <div class="form-title">{hasPin ? "Enter access PIN" : "Sign in to continue"}</div>
    <div class="form-sub">
      {hasPin
        ? "This deployment is protected. Enter the PIN you were given to continue."
        : "Choose how you'd like to authenticate."}
    </div>

    <DomainPill domain={domain} />

    {hasPin ? <PinAuth /> : <OrgEmailAuth orgAuthorizeUrl={orgAuthorizeUrl} />}

    <div id="msg" class="msg" />

    <div class="form-footer">
      {hasPin
        ? "Don't have the PIN? Ask whoever shared this link with you."
        : "Don't have access? Contact the site's administrator or developer to request an invite."}
    </div>
  </div>
);

export const AccessWall: FC<{
  domain: string;
  returnPath: string;
  orgAuthorizeUrl: string;
  /** The route has a PIN configured → the wall asks for the PIN, only. */
  hasPin?: boolean;
}> = ({ domain, returnPath, orgAuthorizeUrl, hasPin = false }) => (
  <Page title="Otterdeploy — Sign in" hideFoot css={accessWallBaseCss + accessWallFormCss}>
    <div class="bg-grid" aria-hidden="true" />
    <div class="bg-glow" aria-hidden="true" />

    <div class="topbar">
      <Wordmark />
    </div>

    <main class="center">
      <AccessWallCard domain={domain} orgAuthorizeUrl={orgAuthorizeUrl} hasPin={hasPin} />
    </main>

    <div class="page-footer">
      <span>
        STATUS: <span class="pf-accent">AWAITING SIGN-IN</span>
      </span>
      <span>OTTERDEPLOY PLATFORM</span>
    </div>

    <script
      dangerouslySetInnerHTML={{
        __html: `
  var RETURN=${JSON.stringify(returnPath)};
  var msg=document.getElementById('msg');
  function set(t,cls){msg.textContent=t;msg.className='msg '+(cls||'');}
  var emailForm=document.getElementById('emailForm'),codeForm=document.getElementById('codeForm'),
      emailEl=document.getElementById('email'),codeEl=document.getElementById('code');
  if(emailForm){
    emailForm.addEventListener('submit',async function(e){
      e.preventDefault();set('Sending…');
      await fetch('/.well-known/otterdeploy/otp/request',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({email:emailEl.value})});
      emailForm.classList.add('hide');codeForm.classList.remove('hide');codeEl.focus();
      set('If '+emailEl.value+' is invited, a code is on its way.','ok');
    });
    codeForm.addEventListener('submit',async function(e){
      e.preventDefault();set('Verifying…');
      var r=await fetch('/.well-known/otterdeploy/otp/verify',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({email:emailEl.value,code:codeEl.value,return:RETURN})});
      var d=await r.json().catch(function(){return {};});
      if(r.ok&&d.ok){location.replace(d.redirect||RETURN);}else{set(d.error||'Invalid or expired code','err');}
    });
  }
  var pinForm=document.getElementById('pinForm'),pinEl=document.getElementById('pin');
  if(pinForm)pinForm.addEventListener('submit',async function(e){
    e.preventDefault();set('Checking…');
    var r=await fetch('/.well-known/otterdeploy/pin/verify',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({pin:pinEl.value,return:RETURN})});
    var d=await r.json().catch(function(){return {};});
    if(r.ok&&d.ok){location.replace(d.redirect||RETURN);}else{set(d.error||'Invalid PIN','err');}
  });`,
      }}
    />
  </Page>
);
