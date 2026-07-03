/**
 * html-export-shell.test.ts — S3: the self-contained HTML shell assembler
 * (engine/html-shell.ts). Locks: N slides wrapped with exactly one active, inline
 * nav + print CSS, no external references, and the WYSIWYG guardrail that slides
 * only animate via opacity/transform (never reflow properties).
 */
import { describe, it, expect } from "vitest";
import { assembleHtmlDeck } from "../src/engine/html-shell";

const STAGE = { stageW: 1279.68, stageH: 720 };

describe("HTML export S3: shell assembler", () => {
  it("wraps N slides into one self-contained document, first slide active", () => {
    const doc = assembleHtmlDeck(["<div>SlideA</div>", "<div>SlideB</div>"], { title: "Q4", ...STAGE });
    expect(doc.startsWith("<!doctype html>")).toBe(true);
    expect((doc.match(/<section class="slide/g) ?? []).length).toBe(2);
    expect((doc.match(/class="slide active"/g) ?? []).length).toBe(1); // exactly one active
    expect(doc).toContain("SlideA");
    expect(doc).toContain("SlideB");
    expect(doc).toContain("<title>Q4</title>");
    expect(doc).toContain("1 / 2"); // counter
  });

  it("defaults the title when none given", () => {
    expect(assembleHtmlDeck(["<div/>"], STAGE)).toContain("<title>SlideCraft</title>");
  });

  it("includes inline nav (keyboard/click/hash/fullscreen) + print CSS, no external refs", () => {
    const doc = assembleHtmlDeck(["<div>x</div>"], STAGE);
    expect(doc).toContain("addEventListener('keydown'");
    expect(doc).toContain("requestFullscreen");
    expect(doc).toContain("history.replaceState"); // #hash deep-link
    expect(doc).toContain("@media print");
    expect(doc).toContain("landscape");
    expect(doc).not.toMatch(/(?:src|href)\s*=\s*["']https?:/); // fully self-contained
  });

  it("animates only with opacity/transform — never reflow properties (WYSIWYG guardrail)", () => {
    const doc = assembleHtmlDeck(["<div>x</div>"], STAGE);
    expect(doc).toContain("transition:opacity"); // slide cross-fade
    expect(doc).not.toMatch(/transition:[^;}"]*(?:width|height|top|left|margin|padding|inset)/);
  });

  it("transition:'none' selects the non-animating mode (data-transition=none)", () => {
    // NOTE: transition CSS for every mode is now always emitted and selected by the
    // <html data-transition> attribute, so "none" is expressed by the attribute value.
    const doc = assembleHtmlDeck(["<div>x</div>"], { ...STAGE, transition: "none" });
    // The <html> element carries the selected mode (CSS selectors mention every mode).
    expect(doc).toMatch(/<html[^>]*data-transition="none"/);
  });
});
