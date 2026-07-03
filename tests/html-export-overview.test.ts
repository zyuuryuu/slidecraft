/**
 * html-export-overview.test.ts — expressiveness: the overview grid ('o') in the
 * standalone HTML shell. Locks the no-DOM-duplication fixed-thumbnail approach and
 * its load-bearing details: the stage inline-transform must be beaten with
 * !important, all thumbs forced visible over the hidden base, a constant CSS thumb
 * scale, screen-scoping so print stays one-per-page, click/keyboard picking, and a11y.
 */
import { describe, it, expect } from "vitest";
import { assembleHtmlDeck } from "../src/engine/html-shell";

const STAGE = { stageW: 1279.68, stageH: 720 };
const doc = (slides = ["<div>A</div>", "<div>B</div>", "<div>C</div>"]) => assembleHtmlDeck(slides, STAGE);

describe("HTML export: overview grid", () => {
  it("scopes the grid to @media screen so print stays one-per-page", () => {
    const d = doc();
    const screen = d.slice(d.indexOf("@media screen{"), d.indexOf("@media (prefers-reduced-motion:reduce){"));
    expect(screen).toContain("body.ov .stage");
    expect(screen).toContain("display:grid");
    const print = d.slice(d.indexOf("@media print{"), d.indexOf("</style>"));
    expect(print).toContain("break-after:page");
    expect(print).not.toContain("body.ov"); // overview never leaks into print
  });

  it("neutralizes the stage's inline transform with !important (beats fit())", () => {
    expect(doc()).toContain("body.ov .stage{position:static;transform:none!important;display:grid");
  });

  it("forces all thumbs visible over the hidden base and clips each slot", () => {
    const d = doc();
    expect(d).toMatch(/body\.ov \.slide\{[^}]*visibility:visible!important/);
    expect(d).toMatch(/body\.ov \.slide\{[^}]*overflow:hidden/);
  });

  it("scales the SSR child by a constant 240/stageW (no per-thumb JS measure)", () => {
    const scale = (240 / STAGE.stageW).toFixed(6);
    expect(doc()).toContain(`body.ov .slide>*{transform:scale(${scale});transform-origin:top left`);
  });

  it("hides fixed chrome and makes the viewport scrollable in overview", () => {
    const d = doc();
    expect(d).toContain("body.ov .progress,body.ov .counter{display:none}");
    expect(d).toContain("body.ov .viewport{overflow:auto}");
  });

  it("toggles on 'o'/Escape and picks a thumb by data-i (click + Enter)", () => {
    const d = doc();
    expect(d).toContain("classList.add('ov')");
    expect(d).toContain("'Escape'");
    expect(d).toContain("closest('.slide')"); // click delegation in overview
  });

  it("adds/removes a11y attrs only in overview and guards fit()", () => {
    const d = doc();
    expect(d).toContain("setAttribute('role','button')");
    expect(d).toContain("setAttribute('aria-label'");
    expect(d).toContain("removeAttribute('aria-label')");
    expect(d).toContain("function fit(){if(ov)return;"); // fit no-ops while overview owns the stage
  });

  it("1-slide deck: no NaN, overview + transitions still present", () => {
    const d = doc(["<div>only</div>"]);
    expect(d).not.toContain("NaN");
    expect(d).toContain("1 / 1");
    expect(d).toContain("body.ov .stage");
  });
});
