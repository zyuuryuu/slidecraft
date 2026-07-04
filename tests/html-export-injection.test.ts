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

describe("HTML export: exported file carries a restrictive CSP (F2 — ADR-0016)", () => {
  it("emits a CSP <meta> that blocks external egress and runs only the nonce'd nav script", () => {
    const doc = assembleHtmlDeck(["<div>ok</div>"], { title: "t", stageW: 100, stageH: 100, cspNonce: "TESTNONCE" });
    // A CSP meta is present with a locked-down default-src (no external script/img/fetch).
    expect(doc).toMatch(/<meta http-equiv="Content-Security-Policy" content="[^"]*default-src 'none'[^"]*">/);
    // Scripts run ONLY via the matching nonce — never 'unsafe-inline' (an injected inline
    // handler/script would have no nonce and be blocked). Styles may stay inline.
    expect(doc).toContain("script-src 'nonce-TESTNONCE'");
    expect(doc).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    // The legit inline nav script carries the nonce so it still runs.
    expect(doc).toContain('<script nonce="TESTNONCE">');
    // No remote connect target → the data/key exfil channel is closed even if script ran.
    expect(doc).not.toMatch(/connect-src[^;]*https?:/);
  });

  it("omits the CSP meta when no nonce is supplied (legacy/unit callers)", () => {
    const doc = assembleHtmlDeck(["<div/>"], { title: "t", stageW: 100, stageH: 100 });
    expect(doc).not.toContain("Content-Security-Policy");
  });
});
