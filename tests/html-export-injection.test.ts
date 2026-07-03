/**
 * html-export-injection.test.ts — S3 security: the SSR'd slide HTML is React-
 * escaped, but the shell concatenates the deck title raw. That value is untrusted
 * (it can come from arbitrary input) and MUST be escaped so the exported file
 * can't smuggle live markup. (Slide-text escaping is React's job and is covered
 * by the SSR tests; this locks the one shell-level string.)
 */
import { describe, it, expect } from "vitest";
import { assembleHtmlDeck } from "../src/engine/html-shell";

describe("HTML export: shell escapes the untrusted deck title", () => {
  it("neutralizes a </title><script> injection payload", () => {
    const doc = assembleHtmlDeck(["<div>ok</div>"], {
      title: "</title><script>alert(1)</script>",
      stageW: 100,
      stageH: 100,
    });
    expect(doc).not.toContain("<script>alert(1)"); // no live injected script
    expect(doc).not.toContain("</title><script>"); // title cannot be broken out of
    expect(doc).toContain("&lt;/title&gt;&lt;script&gt;"); // rendered as inert text
  });

  it("escapes quotes/ampersands in the title", () => {
    const doc = assembleHtmlDeck(["<div/>"], { title: 'A & "B"', stageW: 100, stageH: 100 });
    expect(doc).toContain("<title>A &amp; &quot;B&quot;</title>");
  });
});
