/**
 * The access wall: a single centered card over the full-page grid.
 *
 * PIN-protected routes ask for the PIN and NOTHING else: the PIN takes
 * priority, so the card never offers org/email auth beside it. Routes without
 * a PIN offer org sign-in OR email one-time-code entry (Cloudflare-style,
 * two-step form handled inline). Posts to the OTP/PIN endpoints on this same
 * domain and navigates to `returnPath` on success. Icons are inline SVG (no
 * external icon CDN): these pages are server-rendered strings with no bundler,
 * so the app's React brand component can't be imported; the mark's geometry is
 * copied from `mark-geometry.ts` instead of redrawn. Subcomponents exist purely
 * to keep each function under the line cap.
 */

import type { FC } from "hono/jsx";

import { accessWallBaseCss } from "./css/wall-base";
import { accessWallFormCss } from "./css/wall-form";
import { fieldCss, fieldScript } from "./field";
import { Page } from "./frame";
import { OrgEmailAuth, PinAuth } from "./wall-forms";

const Wordmark: FC = () => (
  <div class="wordmark">
    {/* Slashed zero, MARK_RING + MARK_GLYPHS.idle from
        apps/web/src/shared/components/brand/mark-geometry.ts, which is generated
        by brand/scripts/build.sh. Ring rides currentColor; only the counter is
        chromatic, exactly as OtterdeployMark composes it. */}
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
    <span class="wordmark-name">otterdeploy</span>
  </div>
);

const AuthTarget: FC<{ domain: string }> = ({ domain }) => (
  <div class="target">
    <div class="target-label">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.4"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <rect x="4" y="10.5" width="16" height="11" rx="2.5" />
        <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
      </svg>
      Protected site
    </div>
    <span class="target-host">{domain}</span>
  </div>
);

/** The centered auth card: context head + domain pill + the ONE auth path. */
const AccessWallCard: FC<{ domain: string; orgAuthorizeUrl: string; hasPin: boolean }> = ({
  domain,
  orgAuthorizeUrl,
  hasPin,
}) => (
  <div class="card">
    {/* Head settles WHERE you are before the eye reaches anything actionable:
        the host is what a visitor has to verify before typing a credential. */}
    <div class="card-head">
      <div class="card-eyebrow">Access request</div>
      <div class="form-title">{hasPin ? "Enter access PIN" : "Sign in to continue"}</div>
      <div class="form-sub">
        {hasPin
          ? "This deployment is protected. Enter the PIN you were given to continue."
          : "Choose how you'd like to authenticate."}
      </div>
      <AuthTarget domain={domain} />
    </div>

    <div class="controls">
      {hasPin ? <PinAuth /> : <OrgEmailAuth orgAuthorizeUrl={orgAuthorizeUrl} />}

      <div id="msg" class="msg" />

      <div class="form-footer">
        {hasPin
          ? "Don't have the PIN? Ask whoever shared this link with you."
          : "Don't have access? Contact the site's administrator or developer to request an invite."}
      </div>
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
  <Page
    title="Otterdeploy: Sign in"
    hideFoot
    css={accessWallBaseCss + accessWallFormCss + fieldCss}
  >
    <div class="bg-grid" aria-hidden="true" />
    <div class="bg-glow" aria-hidden="true" />
    {/* Drawn over the static grid, which stays as the floor if canvas is
        unavailable: the page must never depend on the script to look finished. */}
    <canvas id="field" class="bg-field" aria-hidden="true" />
    <div class="bg-veil" aria-hidden="true" />

    <div class="topbar">
      <Wordmark />
    </div>

    <main class="center">
      <AccessWallCard domain={domain} orgAuthorizeUrl={orgAuthorizeUrl} hasPin={hasPin} />
    </main>

    <div class="page-footer">
      <span>
        STATUS:{" "}
        <span id="pfStatus" class="pf-accent">
          AWAITING SIGN-IN
        </span>
      </span>
      <span>OTTERDEPLOY PLATFORM</span>
    </div>

    <script
      dangerouslySetInnerHTML={{
        __html:
          fieldScript("live") +
          `
  var RETURN=${JSON.stringify(returnPath)};
  var msg=document.getElementById('msg');
  function set(t,cls){msg.textContent=t;msg.className='msg '+(cls||'');}
  /* The footer status was hard-coded to AWAITING SIGN-IN for the whole flow,
     so it read as decoration. Drive it from the step we already track. */
  var st=document.getElementById('pfStatus');
  function step(t){if(st)st.textContent=t;}
  var emailForm=document.getElementById('emailForm'),codeForm=document.getElementById('codeForm'),
      emailEl=document.getElementById('email'),codeEl=document.getElementById('code');
  if(emailForm){
    emailForm.addEventListener('submit',async function(e){
      e.preventDefault();set('Sending…');
      await fetch('/.well-known/otterdeploy/otp/request',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({email:emailEl.value})});
      emailForm.classList.add('hide');codeForm.classList.remove('hide');codeEl.focus();
      step('CODE SENT');
      set('If '+emailEl.value+' is invited, a code is on its way.','ok');
    });
    codeForm.addEventListener('submit',async function(e){
      e.preventDefault();set('Verifying…');step('VERIFYING');
      var r=await fetch('/.well-known/otterdeploy/otp/verify',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({email:emailEl.value,code:codeEl.value,return:RETURN})});
      var d=await r.json().catch(function(){return {};});
      if(r.ok&&d.ok){step('GRANTED');location.replace(d.redirect||RETURN);}
      else{step('CODE SENT');set(d.error||'Invalid or expired code','err');}
    });
  }
  var pinForm=document.getElementById('pinForm'),pinEl=document.getElementById('pin');
  if(pinForm)step('LOCKED');
  if(pinForm)pinForm.addEventListener('submit',async function(e){
    e.preventDefault();set('Checking…');step('CHECKING PIN');
    var r=await fetch('/.well-known/otterdeploy/pin/verify',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({pin:pinEl.value,return:RETURN})});
    var d=await r.json().catch(function(){return {};});
    if(r.ok&&d.ok){step('GRANTED');location.replace(d.redirect||RETURN);}
    else{step('LOCKED');set(d.error||'Invalid PIN','err');}
  });`,
      }}
    />
  </Page>
);
