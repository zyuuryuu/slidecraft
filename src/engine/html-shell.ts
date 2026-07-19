/**
 * html-shell.ts — Self-contained standalone-HTML presentation shell (S3/expressiveness
 * of docs/design/html-output.md). Pure string assembly (R2: no DOM/Tauri).
 *
 * Takes N pre-rendered slide-HTML strings (each a fixed `stageW×stageH` px block
 * produced by SSR-ing SlideCard at a fixed scale) and wraps them into ONE openable
 * `.html` document: inline CSS + inline nav JS, a fixed reference stage that CSS
 * `transform: scale()`s to fit any viewport (the laid-out slide DOM only scales —
 * wrapping is frozen, matching the preview 1:1).
 *
 * EXPRESSIVENESS (all transform/opacity only — the slide CONTENT DOM is never touched,
 * so WYSIWYG holds; no reflow property is ever transitioned):
 *  - slide transitions fade / slide / zoom / push, selected by <html data-transition>,
 *    with a leaving-slide state machine so both slides animate; 't' cycles them live.
 *  - an overview grid ('o'): all slides as fixed-scale thumbnails, ZERO DOM duplication.
 *  - print CSS lays each slide one-per-page; motion/overview are @media screen only.
 *
 * The slide HTML strings are React-escaped by the SSR step; shell-level values (deck title,
 * transition token) are escaped/whitelisted here. One SSR sink is raw (MermaidDirect's
 * dangerouslySetInnerHTML), fed only by a fresh securityLevel:"strict" mermaid render — but a
 * persisted svgCache is dropped on open (project-io) and, as belt-and-suspenders, the exported
 * document is locked under a CSP via `opts.cspNonce` (default-src 'none', script only by nonce).
 * See ADR-0016 F2.
 */

const TRANSITIONS = ["fade", "slide", "zoom", "push", "none"] as const;
export type Transition = (typeof TRANSITIONS)[number];

const THUMB_W = 240; // overview thumbnail width (px); height derived to keep the slide aspect

export interface HtmlShellOptions {
  /** Document <title>. Escaped. */
  title?: string;
  /** Reference-stage size in px = the slide's rendered width/height (SLIDE_W×scale). */
  stageW: number;
  stageH: number;
  /** Default slide transition (viewer can cycle with 't'). Default "slide". */
  transition?: Transition;
  /** Per-export random nonce for the inline nav script. When set, the document gets a
   *  restrictive CSP (`default-src 'none'`; scripts only via this nonce) so the exported
   *  `.html` — which has no CSP otherwise — can't run injected inline script or phone home.
   *  The orchestrator (deck-html-export) generates it; engine stays pure (R2). ADR-0016 F2. */
  cspNonce?: string;
  /** Per-slide speaker-note text (#150 / ADR-0032): index-aligned with `slideHtmls`, plain
   *  Markdown text (escaped here). Default HIDDEN; the viewer toggles the panel with 'n'.
   *  Absent/empty → the document is byte-identical to a pre-notes export (invariant). */
  notes?: (string | undefined | null)[];
  /** Runtime CJK subset fonts to embed as @font-face (#193/#115-b subset generation, #194 wiring —
   *  default ON, no toggle). Each face's `family` must already appear in the slides' rendered
   *  font-family CSS (font-stack.ts's embedFallbackFamily) so it's picked up with zero per-element
   *  changes. Absent/empty → the document is byte-identical to a pre-embedding export (do-no-harm). */
  embeddedFonts?: EmbeddedFontFace[];
}

/** One subsetted, base64-encoded raw sfnt (TTF) font face to embed via @font-face (#194). Raw TTF,
 *  not WOFF2 — see font-subsetter.ts's file header for why (a WOFF2 compression step via `wawoff2`
 *  hangs forever in real browsers; harfbuzz's own subset output is embedded directly instead). */
export interface EmbeddedFontFace {
  /** font-family name this face installs (an existing fallback-chain entry, not a new one). */
  family: string;
  /** Static weight the source was pinned to at subset time (font-subsetter's `wght` option). */
  weight: 400 | 700;
  /** Base64-encoded raw sfnt (TTF) bytes — no `data:` prefix, this function adds it. */
  ttfBase64: string;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shellCss(stageW: number, stageH: number): string {
  const thumbScale = (THUMB_W / stageW).toFixed(6);
  const thumbH = Math.round(stageH * (THUMB_W / stageW));
  return `
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;background:#0a0e1a;overflow:hidden;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
.viewport{position:fixed;inset:0;overflow:hidden}
/* Fixed reference stage: slides stack here at native size; JS scales+centers ONLY this,
   so slide DOM never re-lays-out (wrapping stays identical to the preview). */
.stage{position:absolute;top:0;left:0;width:${stageW}px;height:${stageH}px;transform-origin:0 0}
/* Base slide: hidden, NO transition (so slide 0 doesn't animate on load; only .active/.leaving
   animate, and only transform/opacity ever do). */
.slide{position:absolute;inset:0;opacity:0;visibility:hidden}
.slide.active{opacity:1;visibility:visible;z-index:2}
.slide.leaving{visibility:visible;z-index:1}         /* outgoing — kept paintable for the transition */
.counter{position:fixed;right:14px;bottom:10px;font:600 13px/1 system-ui,sans-serif;color:#8b96b0;user-select:none;letter-spacing:.02em}
.progress{position:fixed;left:0;bottom:0;width:100%;height:3px;background:#3B82F6;transform:scaleX(0);transform-origin:left}

/* ── Motion + overview live in a screen-only block; print never inherits them ── */
@media screen{
  .progress{transition:transform .18s ease}

  /* Transition modes — picked by <html data-transition>. Incoming uses a transient .entering
     from-state (JS forces a reflow between it and .active); outgoing uses .leaving. */
  html[data-transition="fade"] .slide.active{transition:opacity .18s ease}
  html[data-transition="fade"] .slide.leaving{opacity:0;transition:opacity .18s ease}

  html[data-transition="slide"] .slide.entering{opacity:0;transform:translateX(calc(var(--dir,1)*40px))}
  html[data-transition="slide"] .slide.active{opacity:1;transform:translateX(0);transition:opacity .22s ease,transform .22s cubic-bezier(.22,.61,.36,1)}
  html[data-transition="slide"] .slide.leaving{opacity:0;transition:opacity .18s ease}

  html[data-transition="zoom"] .slide.entering{opacity:0;transform:scale(.92)}
  html[data-transition="zoom"] .slide.active{opacity:1;transform:scale(1);transition:opacity .2s ease,transform .24s cubic-bezier(.22,.61,.36,1)}
  html[data-transition="zoom"] .slide.leaving{opacity:0;transition:opacity .18s ease}

  html[data-transition="push"] .slide.entering{opacity:1;transform:translateX(calc(var(--dir,1)*100%))}
  html[data-transition="push"] .slide.active{opacity:1;transform:translateX(0);transition:transform .32s cubic-bezier(.4,0,.2,1)}
  html[data-transition="push"] .slide.leaving{opacity:1;transform:translateX(calc(var(--dir,1)*-100%));transition:transform .32s cubic-bezier(.4,0,.2,1)}

  /* Overview grid ('o'): fixed-scale thumbnails, NO DOM duplication. The stage's inline
     transform (set by fit()) is beaten with !important; the SlideCard box stays full-size
     so each .slide is a clipping slot and the child is scaled by a constant. */
  body.ov .viewport{overflow:auto}
  body.ov .stage{position:static;transform:none!important;display:grid;grid-template-columns:repeat(auto-fill,${THUMB_W}px);gap:16px;padding:24px;width:auto;height:auto;justify-content:center;align-content:start}
  body.ov .slide{position:static;inset:auto;width:${THUMB_W}px;height:${thumbH}px;overflow:hidden;opacity:1!important;visibility:visible!important;transform:none!important;transition:none;cursor:pointer;border:2px solid transparent;border-radius:6px;background:#0f1524}
  body.ov .slide>*{transform:scale(${thumbScale});transform-origin:top left;pointer-events:none}
  body.ov .slide.ovsel{border-color:#3B82F6}
  body.ov .slide:focus-visible{outline:2px solid #60a5fa;outline-offset:2px}
  body.ov .progress,body.ov .counter{display:none}
}

/* Reduced motion: kill ALL motion incl. the directional/scale transforms, instant settle. */
@media (prefers-reduced-motion:reduce){
  .slide,.slide.active,.slide.leaving,.slide.entering{transition:none!important;transform:none!important}
  .progress{transition:none}
}

/* Print: one slide per page; motion + overview are screen-scoped above and never apply here. */
@media print{
  /* print-color-adjust:exact forces slide backgrounds/decorations/table fills to PRINT even when
     the browser's "Background graphics" toggle is off (its default). Inherited → covers all slides. */
  html,body{background:#fff;overflow:visible;width:auto;height:auto;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .progress,.counter{display:none}
  /* The screen viewport is position:fixed;overflow:hidden — MUST be reset or it clips every
     slide onto the first printed page (the "all slides on one sheet" bug). */
  .viewport{position:static;overflow:visible;inset:auto}
  .stage{position:static;transform:none!important;width:${stageW}px;height:auto}
  .slide{position:static;inset:auto;opacity:1!important;visibility:visible!important;transform:none!important;width:${stageW}px;height:${stageH}px;break-after:page;page-break-after:always;break-inside:avoid}
  .slide>*{transform:none!important}
  /* Explicit 1280x720 IS landscape-shaped; the landscape KEYWORD cannot be combined with
     explicit lengths (invalid, ignored, defaults to portrait), so omit it. */
  @page{size:${Math.round(stageW)}px ${Math.round(stageH)}px;margin:0}
}`;
}

/** Inline navigation runtime. STAGE_W/STAGE_H are baked in from opts. */
function shellJs(stageW: number, stageH: number): string {
  return `(function(){
var SW=${stageW},SH=${stageH};
var slides=[].slice.call(document.querySelectorAll('.slide'));
var stage=document.querySelector('.stage'),counter=document.getElementById('counter'),bar=document.getElementById('progress');
var root=document.documentElement,body=document.body;
var n=slides.length,i=0,ov=false,gen=0,leaveTimers=[],pending=[];
var reduce=matchMedia('(prefers-reduced-motion:reduce)');
var MODES=['fade','slide','zoom','push'];
function fit(){if(ov)return;var s=Math.min(innerWidth/SW,innerHeight/SH);stage.style.transform='translate('+((innerWidth-SW*s)/2)+'px,'+((innerHeight-SH*s)/2)+'px) scale('+s+')';}
/* Hard-reset transient state so held-key nav never leaks a stuck 'leaving' slide, and DETACH any
   pending transitionend listener from the superseded outgoing slide (its timeout is cleared here,
   so it can't self-detach — track+remove it to avoid zombie listeners over a long presentation). */
function resetSlides(){for(var t=0;t<leaveTimers.length;t++)clearTimeout(leaveTimers[t]);leaveTimers.length=0;for(var p=0;p<pending.length;p++)pending[p].el.removeEventListener('transitionend',pending[p].fn);pending.length=0;for(var j=0;j<n;j++){slides[j].classList.remove('leaving','entering');slides[j].style.transition='';slides[j].style.transform='';}}
function markSel(){for(var j=0;j<n;j++)slides[j].classList.toggle('ovsel',j===i);}
function chrome(k){counter.textContent=(k+1)+' / '+n;bar.style.transform='scaleX('+(n>1?k/(n-1):1)+')';var h='#'+(k+1);if(location.hash!==h)history.replaceState(null,'',h);}
function show(k){
  var prev=i;k=Math.max(0,Math.min(n-1,k));gen++;resetSlides();chrome(k);
  var mode=root.getAttribute('data-transition');
  /* Instant settle: same slide, overview open, reduced motion, or a non-animating mode. */
  if(k===prev||ov||reduce.matches||MODES.indexOf(mode)<0){
    for(var a=0;a<n;a++)slides[a].classList.toggle('active',a===k);i=k;
    if(ov){markSel();if(slides[i])slides[i].scrollIntoView({block:'nearest'});}
    return;
  }
  var dir=k>prev?1:-1;root.style.setProperty('--dir',String(dir));
  var incoming=slides[k],outgoing=slides[prev];
  outgoing.classList.remove('active');outgoing.classList.add('leaving');
  /* Apply the from-state with transitions OFF, force a reflow to commit the start frame,
     then flip to .active so the CSS transition has two distinct values to interpolate. */
  incoming.style.transition='none';incoming.classList.add('entering');void incoming.offsetWidth;
  incoming.style.transition='';incoming.classList.remove('entering');incoming.classList.add('active');
  var thisGen=gen,out=outgoing;
  /* e is absent when called by the timeout; ignore transitionend bubbling up from slide content
     (only the outgoing slide's own leave animation should trigger cleanup). Detach unconditionally. */
  function done(e){if(e&&e.target!==out)return;out.removeEventListener('transitionend',done);if(thisGen!==gen)return;out.classList.remove('leaving');out.style.transform='';out.style.transition='';}
  out.addEventListener('transitionend',done);pending.push({el:out,fn:done});leaveTimers.push(setTimeout(done,440));/* safety net for interrupted transitionend */
  i=k;
}
/* ── Overview ── */
function enterOv(){if(ov||n<1)return;ov=true;body.classList.add('ov');for(var j=0;j<n;j++){var s=slides[j];s.setAttribute('role','button');s.setAttribute('tabindex','0');s.setAttribute('aria-label','スライド '+(j+1));}markSel();var t=slides[i];if(t){t.scrollIntoView({block:'center'});t.focus&&t.focus();}}
function exitOv(){if(!ov)return;ov=false;body.classList.remove('ov');for(var j=0;j<n;j++){var s=slides[j];s.removeAttribute('role');s.removeAttribute('tabindex');s.removeAttribute('aria-label');s.classList.remove('ovsel');}fit();}
function toggleOv(){ov?exitOv():enterOv();}
function cycleMode(){var x=MODES.indexOf(root.getAttribute('data-transition'));root.setAttribute('data-transition',MODES[(x+1)%MODES.length]);}
addEventListener('keydown',function(e){
  if(ov){
    if(e.key==='Escape'||e.key==='o'||e.key==='O'){toggleOv();e.preventDefault();return;}
    if(e.key==='Enter'||e.key===' '){var t=e.target;if(t&&t.classList&&t.classList.contains('slide')){var idx=slides.indexOf(t);if(idx>=0){show(idx);exitOv();}e.preventDefault();}return;}
    return;/* swallow nav keys while the grid owns the screen */
  }
  if(e.key==='o'||e.key==='O'){toggleOv();e.preventDefault();return;}
  if(e.key==='t'||e.key==='T'){cycleMode();e.preventDefault();return;}
  if(e.key==='ArrowRight'||e.key===' '||e.key==='PageDown'){show(i+1);e.preventDefault();}
  else if(e.key==='ArrowLeft'||e.key==='PageUp'){show(i-1);e.preventDefault();}
  else if(e.key==='Home'){show(0);}
  else if(e.key==='End'){show(n-1);}
  else if(e.key==='f'){if(!document.fullscreenElement){root.requestFullscreen&&root.requestFullscreen();}else{document.exitFullscreen();}}
});
addEventListener('click',function(e){
  if(ov){var s=e.target&&e.target.closest?e.target.closest('.slide'):null;if(s){var idx=slides.indexOf(s);if(idx>=0){show(idx);exitOv();}}return;}
  if(e.clientX<innerWidth/3)show(i-1);else show(i+1);
});
addEventListener('resize',fit);
addEventListener('hashchange',function(){var k=parseInt(location.hash.slice(1),10);if(k)show(k-1);});
/* Init: activate the start slide with NO transition (deep-link or slide 0). */
var start=parseInt((location.hash||'').slice(1),10);start=(start>=1&&start<=n)?start-1:0;
for(var j=0;j<n;j++)slides[j].classList.toggle('active',j===start);i=start;chrome(start);fit();
})();`;
}

// ── Speaker notes (#150 / ADR-0032): default-hidden panel + 'n' toggle ──
// A SEPARATE add-on (CSS/markup/JS strings below) appended ONLY when a note exists, so a
// no-notes export never enters this code path (byte-identical invariant). The runtime is its
// own IIFE that observes #counter (chrome() rewrites it on every show; history.replaceState
// fires no hashchange, so the counter is the only reliable "current slide" signal) — the nav
// script itself stays untouched. CSP: it rides inside the SAME nonce'd <script> tag.

const NOTES_CSS = `
.notesrc{display:none}
.notespanel{display:none}
body.shownotes .notespanel{display:block;position:fixed;left:0;right:0;bottom:0;max-height:34%;overflow:auto;background:rgba(10,14,26,.94);color:#dbe2f0;border-top:1px solid #2a3550;padding:14px 18px 20px;font:400 14px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif;white-space:pre-wrap;z-index:4}
body.shownotes .notespanel:empty{display:none}
body.ov .notespanel{display:none}
@media print{.notespanel,.notesrc{display:none}}`;

const NOTES_JS = `(function(){
var panel=document.getElementById('notespanel'),counter=document.getElementById('counter');
if(!panel||!counter)return;
var srcs={};
[].slice.call(document.querySelectorAll('.notesrc')).forEach(function(el){srcs[el.getAttribute('data-i')]=el.textContent;});
function sync(){var k=parseInt(counter.textContent,10)||1;panel.textContent=srcs[String(k-1)]||'';}
new MutationObserver(sync).observe(counter,{childList:true,characterData:true,subtree:true});
addEventListener('keydown',function(e){if(e.key==='n'||e.key==='N'){document.body.classList.toggle('shownotes');e.preventDefault();}});
sync();
})();`;

/** @font-face rules for embedded CJK subsets (#194). Empty input → empty string, so a no-embedding
 *  export stays byte-identical to the pre-#194 shape (do-no-harm). CSP already allows `font-src
 *  data:` unconditionally (see cspMeta below), so no CSP change is needed for these to load. */
function fontFaceCss(fonts: EmbeddedFontFace[]): string {
  return fonts
    .map((f) => `@font-face{font-family:"${f.family}";font-weight:${f.weight};font-display:swap;src:url(data:font/ttf;base64,${f.ttfBase64}) format("truetype")}`)
    .join("");
}

/** Assemble N pre-rendered slide HTML strings into one self-contained .html document. */
export function assembleHtmlDeck(slideHtmls: string[], opts: HtmlShellOptions): string {
  const { stageW, stageH } = opts;
  const title = esc(opts.title?.trim() || "SlideCraft");
  // Whitelist the transition token (it lands in an attribute; never trust the input value).
  const transition: Transition = TRANSITIONS.indexOf(opts.transition as Transition) >= 0 ? opts.transition! : "slide";
  const n = slideHtmls.length;

  const sections = slideHtmls
    .map((h, i) => `<section class="slide${i === 0 ? " active" : ""}" data-i="${i}">${h}</section>`)
    .join("\n");

  // A per-export nonce turns the exported .html from "no CSP" into a locked-down document:
  // default-src 'none' (no fetch/script/img/font from anywhere), scripts ONLY via this nonce
  // (so an injected inline handler/script can't run), inline styles + data:/blob: images kept
  // (the slides need them). The nonce is attribute-escaped defensively (ADR-0016 F2).
  // Speaker notes: only a deck with ≥1 non-empty note gets the panel/sources/toggle at all.
  const notes = opts.notes ?? [];
  const hasNotes = notes.some((t) => t && t.trim() !== "");
  const notesCss = hasNotes ? NOTES_CSS : "";
  const notesHtml = hasNotes
    ? notes
        .map((t, i) => (t && t.trim() !== "" ? `<div class="notesrc" data-i="${i}" hidden>${esc(t)}</div>` : ""))
        .filter(Boolean)
        .join("\n") + `\n<div class="notespanel" id="notespanel" aria-label="スピーカーノート"></div>\n`
    : "";
  const notesJs = hasNotes ? NOTES_JS : "";

  const fontFaces = fontFaceCss(opts.embeddedFonts ?? []);

  const nonce = opts.cspNonce ? esc(opts.cspNonce) : "";
  const cspMeta = nonce
    ? `\n<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; base-uri 'none'">`
    : "";
  const scriptTag = nonce ? `<script nonce="${nonce}">` : "<script>";

  return `<!doctype html>
<html lang="ja" data-transition="${transition}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">${cspMeta}
<title>${title}</title>
<style>${shellCss(stageW, stageH)}${notesCss}${fontFaces}</style>
</head>
<body>
<div class="viewport"><div class="stage">
${sections}
</div></div>
${notesHtml}<div class="progress" id="progress"></div>
<div class="counter" id="counter">1 / ${n}</div>
${scriptTag}${shellJs(stageW, stageH)}${notesJs}</script>
</body>
</html>`;
}
