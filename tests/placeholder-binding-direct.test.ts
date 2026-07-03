/**
 * placeholder-binding-direct.test.ts — a template's OWN "extra" placeholders (e.g. 官公庁 cover's
 * 資料番号=idx13, メタ情報=idx14, both TYPE=body) must round-trip when the user fills them by hand.
 *
 * Role-binding can't carry these: the SlideIR content idx 13 maps to role "other" (no canonical
 * meaning), but the layout placeholder idx 13 is TYPE body → role "body" — a mismatch, so the
 * hand-typed text was silently dropped (typing into the 資料番号 field did nothing in the preview
 * OR the export). The fix binds such content DIRECTLY by exact idx (a non-canonical content idx can
 * only have come from the user editing THAT template's own placeholder field), while leaving all
 * canonical / alien role-binding untouched.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { loadTemplate, findLayout, type TemplateData, type PlaceholderInfo } from "../src/engine/template-loader";
import { bindContentByRole } from "../src/engine/placeholder-binding";
import { generatePptx } from "../src/engine/placeholder-filler";
import type { SlideIR, PlaceholderContent } from "../src/engine/slide-schema";

const KOKKO = resolve(__dirname, "../public/templates/slide/報告書テンプレート_官公庁_全レイアウト見本.pptx");

function content(idx: string, text: string): PlaceholderContent {
  return { idx, paragraphs: [{ segments: [{ text }] }] };
}

function mkPh(idx: string, type: string, name: string): PlaceholderInfo {
  return {
    idx,
    type,
    name,
    shapeXml: `<p:sp><p:nvSpPr><p:cNvPr id="9" name="${name}"/></p:nvSpPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>x</a:t></a:r></a:p></p:txBody></p:sp>`,
    style: { x: 0, y: 0, w: 1, h: 1, fontSize: 18, fontColor: "000000", fontName: "Meiryo", bold: false, align: "l", bulletChar: "" },
  };
}

describe("hand-filled custom placeholders (官公庁 資料番号 idx13, type body) round-trip", () => {
  let tpl: TemplateData;
  beforeAll(async () => { tpl = await loadTemplate(readFileSync(KOKKO)); });

  it("the cover layout really has a body-TYPED idx-13 placeholder (資料番号)", () => {
    const layout = findLayout(tpl, "00_表紙");
    expect(layout).toBeTruthy();
    const p13 = layout!.placeholders.find((p) => p.idx === "13");
    expect(p13?.type).toBe("body"); // role would be "body" — NOT "other"; role-binding can't reach it
  });

  it("bindContentByRole binds idx-13 content DIRECTLY into the idx-13 placeholder", () => {
    const layout = findLayout(tpl, "00_表紙")!;
    const slide: SlideIR = { layout: "00_表紙", placeholders: [content("15", "カバー"), content("13", "資料3")] };
    const bound = bindContentByRole(slide, layout.placeholders);
    expect(bound.get("13")?.paragraphs[0].segments[0].text).toBe("資料3");
  });

  it("generatePptx writes the hand-typed 資料3 into the exported cover slide", async () => {
    const slide: SlideIR = { layout: "00_表紙", placeholders: [content("15", "カバー"), content("13", "資料3")] };
    const buf = await generatePptx({ slides: [slide] }, tpl);
    const zip = await JSZip.loadAsync(buf);
    const s1 = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(s1).toContain("資料3");
  });
});

describe("Pass-1 idx-exact never hijacks a CANONICAL idx (alien role-binding intact)", () => {
  it("body content at canonical idx 1 does NOT land in an alien idx-1 SUBTITLE placeholder", () => {
    // idx 1 (no ctrTitle) → content role "body"; the alien layout's idx-1 ph is a SUBTITLE.
    // Role-binding correctly leaves it unbound (mismatch); idx-exact must NOT force it in.
    const layoutPhs = [mkPh("1", "subTitle", "Sub"), mkPh("2", "body", "Body")];
    const slide: SlideIR = { layout: "x", placeholders: [content("1", "本文テキスト")] };
    const bound = bindContentByRole(slide, layoutPhs);
    expect(bound.get("1")).toBeUndefined(); // NOT hijacked into the subtitle
  });

  it("canonical title/subtitle still bind by ROLE across differing idxs", () => {
    // Alien: title is ctrTitle at idx 0-less (idx "0" absent → use type), subtitle at idx 7.
    const layoutPhs = [mkPh("4", "ctrTitle", "T"), mkPh("7", "subTitle", "S")];
    const slide: SlideIR = { layout: "x", placeholders: [content("15", "題"), content("16", "副題")] };
    const bound = bindContentByRole(slide, layoutPhs);
    expect(bound.get("4")?.paragraphs[0].segments[0].text).toBe("題"); // title role → ctrTitle
    expect(bound.get("7")?.paragraphs[0].segments[0].text).toBe("副題"); // subtitle role → subTitle
  });
});
