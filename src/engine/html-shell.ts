/**
 * html-shell.ts — Self-contained standalone-HTML presentation shell (S3 of
 * docs/design/html-output.md). Pure string assembly (R2: no DOM/Tauri).
 *
 * Takes N pre-rendered slide-HTML strings (each a fixed `stageW×stageH` px block
 * produced by SSR-ing SlideCard at a fixed scale) and wraps them into ONE op-
 * enable `.html` document: inline CSS + inline nav JS, a fixed reference stage
 * that CSS `transform: scale()`s to fit any viewport (so the already-laid-out DOM
 * only scales — wrapping is frozen, matching the preview 1:1), keyboard/click/hash
 * navigation, a progress bar + counter, and print CSS for one-slide-per-page PDF.
 *
 * The slide HTML strings are trusted (React-escaped by the SSR step); only shell-
 * level values (the deck title) are escaped here.
 */

export interface HtmlShellOptions {
  /** Document <title> + shown nowhere else. Escaped. */
  title?: string;
  /** Reference-stage size in px = the slide's rendered width/height (SLIDE_W×scale). */
  stageW: number;
  stageH: number;
  /** Slide-to-slide transition. "none" disables the cross-fade. Default "fade". */
  transition?: "fade" | "none";
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shellCss(stageW: number, stageH: number, fade: boolean): string {
  return `
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;background:#0a0e1a;overflow:hidden;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
.viewport{position:fixed;inset:0;overflow:hidden}
/* The fixed reference stage: all slides stack here at native size; JS scales+centers
   ONLY this element, so the slide DOM never re-lays-out (wrapping stays identical to the preview). */
.stage{position:absolute;top:0;left:0;width:${stageW}px;height:${stageH}px;transform-origin:0 0}
.slide{position:absolute;inset:0;opacity:0;visibility:hidden${fade ? ";transition:opacity .18s ease" : ""}}
.slide.active{opacity:1;visibility:visible}
/* Chrome — animated with transform/opacity only (never reflow properties). */
.progress{position:fixed;left:0;bottom:0;width:100%;height:3px;background:#3B82F6;transform:scaleX(0);transform-origin:left;transition:transform .18s ease}
.counter{position:fixed;right:14px;bottom:10px;font:600 13px/1 system-ui,sans-serif;color:#8b96b0;user-select:none;letter-spacing:.02em}
@media (prefers-reduced-motion:reduce){.slide{transition:none}.progress{transition:none}}
@media print{
  html,body{background:#fff;overflow:visible}
  .progress,.counter{display:none}
  .stage{position:static;transform:none!important;width:${stageW}px;height:auto}
  .slide{position:static;opacity:1!important;visibility:visible!important;width:${stageW}px;height:${stageH}px;break-after:page;page-break-after:always}
  @page{size:${Math.round(stageW)}px ${Math.round(stageH)}px landscape;margin:0}
}`;
}

/** Inline navigation runtime. STAGE_W/STAGE_H are baked in from opts. */
function shellJs(stageW: number, stageH: number): string {
  return `(function(){
var SW=${stageW},SH=${stageH};
var slides=[].slice.call(document.querySelectorAll('.slide'));
var stage=document.querySelector('.stage'),counter=document.getElementById('counter'),bar=document.getElementById('progress');
var n=slides.length,i=0;
function fit(){var s=Math.min(innerWidth/SW,innerHeight/SH);stage.style.transform='translate('+((innerWidth-SW*s)/2)+'px,'+((innerHeight-SH*s)/2)+'px) scale('+s+')';}
function show(k){i=Math.max(0,Math.min(n-1,k));for(var j=0;j<n;j++)slides[j].classList.toggle('active',j===i);counter.textContent=(i+1)+' / '+n;bar.style.transform='scaleX('+(n>1?i/(n-1):1)+')';var h='#'+(i+1);if(location.hash!==h)history.replaceState(null,'',h);}
addEventListener('keydown',function(e){if(e.key==='ArrowRight'||e.key===' '||e.key==='PageDown'){show(i+1);e.preventDefault();}else if(e.key==='ArrowLeft'||e.key==='PageUp'){show(i-1);e.preventDefault();}else if(e.key==='Home'){show(0);}else if(e.key==='End'){show(n-1);}else if(e.key==='f'){if(!document.fullscreenElement){document.documentElement.requestFullscreen&&document.documentElement.requestFullscreen();}else{document.exitFullscreen();}}});
addEventListener('click',function(e){if(e.clientX<innerWidth/3)show(i-1);else show(i+1);});
addEventListener('resize',fit);
addEventListener('hashchange',function(){var k=parseInt(location.hash.slice(1),10);if(k)show(k-1);});
fit();var st=parseInt((location.hash||'').slice(1),10);show(st?st-1:0);
})();`;
}

/** Assemble N pre-rendered slide HTML strings into one self-contained .html document. */
export function assembleHtmlDeck(slideHtmls: string[], opts: HtmlShellOptions): string {
  const { stageW, stageH } = opts;
  const title = esc(opts.title?.trim() || "SlideCraft");
  const fade = opts.transition !== "none";
  const n = slideHtmls.length;

  const sections = slideHtmls
    .map((h, i) => `<section class="slide${i === 0 ? " active" : ""}" data-i="${i}">${h}</section>`)
    .join("\n");

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>${shellCss(stageW, stageH, fade)}</style>
</head>
<body>
<div class="viewport"><div class="stage">
${sections}
</div></div>
<div class="progress" id="progress"></div>
<div class="counter" id="counter">1 / ${n}</div>
<script>${shellJs(stageW, stageH)}</script>
</body>
</html>`;
}
