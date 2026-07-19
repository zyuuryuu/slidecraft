/**
 * html-export-font-embed-shell.test.ts — S3: html-shell.ts's @font-face injection (#194, part 3 of
 * #115). Locks: embeddedFonts renders one @font-face per face with a data:font/woff2 base64 src;
 * absent/empty embeddedFonts is byte-identical to a pre-embedding export (do-no-harm invariant).
 */
import { describe, it, expect } from "vitest";
import { assembleHtmlDeck } from "../src/engine/html-shell";

const STAGE = { stageW: 1279.68, stageH: 720 };

describe("HTML export: @font-face embedding (html-shell)", () => {
  it("injects an @font-face with a data:font/woff2 base64 src for each embedded face", () => {
    const doc = assembleHtmlDeck(["<div>x</div>"], {
      ...STAGE,
      embeddedFonts: [{ family: "Noto Sans CJK JP", weight: 400, woff2Base64: "AAAA" }],
    });
    expect(doc).toContain("@font-face");
    expect(doc).toMatch(/font-family:"Noto Sans CJK JP"/);
    expect(doc).toMatch(/font-weight:400/);
    expect(doc).toContain('src:url(data:font/woff2;base64,AAAA) format("woff2")');
  });

  it("emits a separate @font-face rule per weight for the same family (regular + bold)", () => {
    const doc = assembleHtmlDeck(["<div>x</div>"], {
      ...STAGE,
      embeddedFonts: [
        { family: "Noto Sans CJK JP", weight: 400, woff2Base64: "REG" },
        { family: "Noto Sans CJK JP", weight: 700, woff2Base64: "BOLD" },
      ],
    });
    expect((doc.match(/@font-face/g) ?? []).length).toBe(2);
    expect(doc).toMatch(/font-weight:400;font-display:swap;src:url\(data:font\/woff2;base64,REG\)/);
    expect(doc).toMatch(/font-weight:700;font-display:swap;src:url\(data:font\/woff2;base64,BOLD\)/);
  });

  it("do-no-harm: an absent embeddedFonts produces byte-identical output to the pre-embedding shape", () => {
    const withField = assembleHtmlDeck(["<div>x</div>"], { ...STAGE, embeddedFonts: [] });
    const withoutField = assembleHtmlDeck(["<div>x</div>"], { ...STAGE });
    expect(withField).toBe(withoutField);
    expect(withoutField).not.toContain("@font-face");
  });
});
