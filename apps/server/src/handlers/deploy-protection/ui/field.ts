/**
 * The lattice field behind every protection screen.
 *
 * A perspective grid of dots running to a horizon, with a deploy wave rolling
 * outward through it — the same world the app's sign-in hero renders
 * (`apps/web/src/features/auth/components/auth-hero-field.ts`). These pages are
 * server-rendered strings with no bundler in the path, so the renderer ships as
 * an inline script rather than an import; the geometry constants are kept in
 * the same shape as the hero's so the two can be diffed by eye.
 *
 * Why a field and not the flat CSS grid it replaces: the grid is the same at
 * every point, so it reads as a texture behind a card. A lattice that recedes
 * gives the card somewhere to be, which is the whole difference between a
 * screen that looks unfinished and one that looks calm.
 *
 * Degrades honestly: no canvas support, `prefers-reduced-motion`, or a
 * zero-size element and the page keeps its background with no script errors —
 * the CSS backdrop underneath is still there.
 */

/** Mood tunes the field to the page's state without changing its shape. */
export type FieldMood =
  /** Sign-in and other live states: full brightness, wave running. */
  | "live"
  /** Denied / 4xx: dimmed, wave stopped. Nothing is broken, so no colour shift. */
  | "dim"
  /** 5xx: dimmed, wave stopped, dots carry the destructive hue. */
  | "danger";

/**
 * The renderer, as an inline `<script>` body. `mood` is baked in at render time
 * rather than read from the DOM so the page carries no extra attributes.
 */
export function fieldScript(mood: FieldMood): string {
  // Accent must match --primary in wall-base.ts; expressed as RGB here because
  // canvas fill wants a concrete channel triple, not an oklch() string.
  const rgb = mood === "danger" ? "232,106,90" : "110,152,255";
  const baseAlpha = mood === "live" ? "1" : "0.42";
  const glowAlpha = mood === "live" ? "0.11" : "0.05";
  const waves = mood === "live" ? "true" : "false";

  return `
(function(){
  var c=document.getElementById('field');
  if(!c||!c.getContext)return;
  var ctx=c.getContext('2d');
  if(!ctx)return;
  var reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var W=0,H=0;
  function size(){
    var d=Math.min(window.devicePixelRatio||1,2);
    W=c.clientWidth;H=c.clientHeight;
    if(!W||!H)return false;
    c.width=Math.round(W*d);c.height=Math.round(H*d);
    ctx.setTransform(d,0,0,d,0,0);
    return true;
  }
  /* Rows widen and space out as they recede, so dot count tracks what is
     actually visible instead of the world box. */
  var rows=[];
  for(var z=-0.55;z<11;z+=0.06+(z+1.6)*0.016){
    var half=0.9+z*0.78,step=0.17+z*0.035,cols=[];
    for(var x=-half;x<=half;x+=step)cols.push(x);
    rows.push({z:z,cols:cols});
  }
  var CAM_H=0.92,FOCAL=2.5,CAM_D=2.6,Z_FAR=11;
  var RGB='${rgb}',BASE=${baseAlpha},GLOW=${glowAlpha},WAVES=${waves};
  function draw(t){
    if(!W||!H)return;
    ctx.clearRect(0,0,W,H);
    /* Haze on the horizon so the far dots dissolve into light, not into panel. */
    var g=ctx.createRadialGradient(W*0.5,H*0.56,0,W*0.5,H*0.56,W*0.62);
    g.addColorStop(0,'rgba('+RGB+','+GLOW+')');
    g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
    var CYCLE=9.7,TRAVEL=6.5;
    var phase=WAVES?(t%CYCLE)/TRAVEL:-1;
    var r=phase*9.2,rippling=phase>=0&&phase<=1;
    for(var i=0;i<rows.length;i++){
      var row=rows[i];
      for(var j=0;j<row.cols.length;j++){
        var x=row.cols[j],lift=0;
        if(rippling){
          var d=Math.sqrt((x-0.4)*(x-0.4)+(row.z-3.4)*(row.z-3.4));
          var off=Math.abs(d-r);
          if(off<0.62){var k=Math.cos((off/0.62)*(Math.PI/2));lift=k*k*0.22*(1-phase*0.55);}
        }
        var zc=row.z+CAM_D;
        if(zc<=0.05)continue;
        var s=FOCAL/zc;
        var sy=H*0.52+(CAM_H-lift)*s*H*0.42;
        if(sy<-20||sy>H+20)continue;
        var sx=W*0.5+x*s*W*0.42;
        var depth=1-Math.min(row.z/Z_FAR,1);
        var lit=lift>0.004;
        var a=(0.05+depth*0.42)*BASE*(lit?2.2:1);
        ctx.fillStyle=lit?'rgba('+RGB+','+Math.min(a,0.85)+')':'rgba(245,245,240,'+Math.min(a,0.5)+')';
        ctx.beginPath();ctx.arc(sx,sy,Math.max(0.35,s*1.15),0,6.2832);ctx.fill();
      }
    }
  }
  var t0=Date.now();
  function loop(){draw((Date.now()-t0)/1000);requestAnimationFrame(loop);}
  if(!size()){
    /* Zero-size at first paint (fonts still loading): retry once on load. */
    window.addEventListener('load',function(){if(size())start();});
  }else start();
  function start(){
    if(reduced||!WAVES){draw(2.2);}else{requestAnimationFrame(loop);}
  }
  var to;
  window.addEventListener('resize',function(){
    clearTimeout(to);
    to=setTimeout(function(){if(size()&&(reduced||!WAVES))draw(2.2);},120);
  });
})();`;
}

/** Styles for the canvas + the vignette that seats the card in the space. */
export const fieldCss = `
      .bg-field {
        position: fixed;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        display: block;
      }
      .bg-veil {
        position: fixed;
        inset: 0;
        pointer-events: none;
        background: radial-gradient(
          120% 90% at 50% 108%,
          transparent 34%,
          rgba(12, 12, 11, 0.72) 82%
        );
      }`;
