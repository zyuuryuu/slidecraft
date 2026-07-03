/**
 * html-export-transitions.test.ts — expressiveness: the four slide transitions
 * (fade/slide/zoom/push) in the standalone HTML shell. Locks the WYSIWYG guardrail
 * (animations are transform/opacity ONLY — never a reflow property), the push
 * leaving-slide state machine, the entering→reflow→active mechanics, --dir
 * direction, reduced-motion coverage, and the whitelisted transition token.
 */
import { describe, it, expect } from "vitest";
import { assembleHtmlDeck, type Transition } from "../src/engine/html-shell";

const STAGE = { stageW: 1279.68, stageH: 720 };
const doc = () => assembleHtmlDeck(["<div>A</div>", "<div>B</div>"], STAGE);

describe("HTML export: rich transitions", () => {
  it("defaults to data-transition=slide on <html>", () => {
    expect(doc()).toMatch(/<html[^>]*data-transition="slide"/);
  });

  it("emits all four modes, and NO transition ever targets a reflow property", () => {
    const d = doc();
    for (const m of ["fade", "slide", "zoom", "push"]) {
      expect(d).toContain(`data-transition="${m}"] .slide.active`);
    }
    // Every declared transition value is transform/opacity only (WYSIWYG guardrail).
    for (const m of d.matchAll(/transition:([^;}"]+)/g)) {
      expect(m[1]).not.toMatch(/width|height|top|left|right|bottom|margin|padding|inset/);
    }
  });

  it("push animates BOTH slides via translateX with opposite --dir signs", () => {
    const d = doc();
    expect(d).toContain('data-transition="push"] .slide.entering{opacity:1;transform:translateX(calc(var(--dir,1)*100%))');
    expect(d).toContain('data-transition="push"] .slide.active{opacity:1;transform:translateX(0)');
    expect(d).toContain('data-transition="push"] .slide.leaving{opacity:1;transform:translateX(calc(var(--dir,1)*-100%))');
  });

  it("keeps a leaving slide paintable; base .slide has no transition (slide 0 doesn't animate on load)", () => {
    const d = doc();
    expect(d).toContain(".slide.leaving{visibility:visible");
    expect(d).toContain(".slide{position:absolute;inset:0;opacity:0;visibility:hidden}");
  });

  it("reduced-motion kills transitions AND the directional/scale transforms", () => {
    const d = doc();
    const rm = d.slice(d.indexOf("@media (prefers-reduced-motion:reduce){"), d.indexOf("@media print{"));
    expect(rm).toContain("transition:none!important");
    expect(rm).toContain("transform:none!important");
  });

  it("show() uses entering→forced-reflow→active + --dir + a generation guard", () => {
    const d = doc();
    expect(d).toContain("classList.add('entering')");
    expect(d).toContain("void incoming.offsetWidth"); // forced reflow commits the start frame
    expect(d).toContain("setProperty('--dir'");
    expect(d).toContain("gen++"); // stale cleanups no-op after rapid nav
  });

  it("'t' cycles the transition mode live", () => {
    expect(doc()).toContain("cycleMode");
  });

  it("cleans up transitionend listeners (no leak on rapid nav; ignores bubbled content events)", () => {
    const d = doc();
    expect(d).toContain("e.target!==out"); // only the outgoing slide's own transitionend cleans up
    expect(d).toContain("pending"); // pending listeners are tracked + detached on the next reset
  });

  it("whitelists the transition token (garbage → default, no attribute injection)", () => {
    const d = assembleHtmlDeck(["<div>x</div>"], { ...STAGE, transition: '"><script>' as unknown as Transition });
    expect(d).toContain('data-transition="slide"'); // fell back to default
    expect(d).not.toContain('data-transition=""><script>');
  });
});
