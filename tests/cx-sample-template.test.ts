/**
 * cx-sample-template.test.ts — REGRESSION: a bare third-party PowerPoint master (CX Sample, all IP
 * stripped) must bind content + follow in preview/export. CX's real content bodies live at idx
 * 10/11/12/13/16 (PowerPoint numbers body placeholders 10+), which collided with SlideCraft's own
 * idx-META convention (idx 10→category, 11→date, 12→footer, 15→title, 16→subtitle) — so every content
 * body was mis-read as meta, content layouts had bodyCount 0, and nothing filled.
 *
 * The fix (usesMetaIdxConvention): that convention is applied ONLY to OUR masters — canonical dotted
 * names OR template-writer output (which emits typed sldNum/dt/ftr meta). A bare master (plain names,
 * NO typed meta) opts out, so its body-typed idx-10..16 placeholders read as real content.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog, usesMetaIdxConvention, type LayoutCatalog } from "../src/engine/template-catalog";
import { generatePptx } from "../src/engine/placeholder-filler";
import { parseMd } from "../src/engine/md-parser";

const DIR = resolve(__dirname, "../public/templates/slide");
const CX = resolve(DIR, "CX_sample_MSGothic.pptx");
const CANON = resolve(DIR, "Midnight_Executive_30_TemplateOnly.pptx");
const REPORT = resolve(DIR, "報告書テンプレート.potx");
// CX Sample + the report .potx are LOCAL-ONLY, IP-stripped company templates (gitignored). Skip the
// tests that need them when they're absent (CI) — they still run for anyone who has the fixture.
const HAS_CX = existsSync(CX);
const HAS_REPORT = existsSync(REPORT);

describe("usesMetaIdxConvention — only OUR masters opt in", () => {
  it.skipIf(!HAS_CX)("bare third-party master (CX: plain names, no typed sldNum/dt/ftr) opts OUT", async () => {
    const tpl = await loadTemplate(readFileSync(CX));
    expect(usesMetaIdxConvention(tpl.layouts)).toBe(false);
  });
  it("canonical (dotted Family.Detail names) opts IN", async () => {
    const tpl = await loadTemplate(readFileSync(CANON));
    expect(usesMetaIdxConvention(tpl.layouts)).toBe(true);
  });
  it.skipIf(!HAS_REPORT)("template-writer output (typed sldNum/dt/ftr meta) opts IN", async () => {
    const tpl = await loadTemplate(readFileSync(REPORT));
    expect(usesMetaIdxConvention(tpl.layouts)).toBe(true);
  });
});

describe.skipIf(!HAS_CX)("CX Sample master — preview/HTML background (inverted theme)", () => {
  it("masterBgColor comes from the real <p:bg> (bg2→lt2=white), NOT themeColors.bg1 (lt1=navy)", async () => {
    // CX inverts the theme: clrMap bg1→lt1=#0D274D(dark), bg2→lt2=#FFFFFF(white); the master's actual
    // <p:bg> is schemeClr bg2 = white. Deriving the preview bg from themeColors.bg1 painted every
    // content slide (which inherits the master bg) dark-navy with near-invisible dark text, while the
    // exported PPTX was white — the reported "HTML preview is broken".
    const tpl = await loadTemplate(readFileSync(CX));
    expect(tpl.masterBgColor).toBe("FFFFFF");
    expect(tpl.masterBgColor).not.toBe("0D274D");
  });
});

describe.skipIf(!HAS_CX)("CX Sample master flows through the harness", () => {
  let tpl: TemplateData;
  let cat: LayoutCatalog;
  beforeAll(async () => {
    tpl = await loadTemplate(readFileSync(CX));
    cat = buildCatalog(tpl);
  });

  it("content layouts expose a REAL body region (bodies at idx 10/16 are content, not meta)", () => {
    // "Title_with bullet text" (body#10) and "Third page…right bullet" (body#16) must have bodyCount≥1.
    const bulletLayout = cat.find((e) => e.name === "Title_with bullet text");
    expect(bulletLayout?.role).toBe("content");
    expect(bulletLayout?.bodyCount).toBeGreaterThanOrEqual(1);
    expect(cat.some((e) => e.role === "content" && e.bodyCount >= 1)).toBe(true);
  });

  it("passes the acceptance gate: has a title role AND a usable body somewhere", () => {
    expect(cat.some((e) => e.hasTitle)).toBe(true);
    expect(cat.some((e) => e.bodyCount >= 1)).toBe(true);
  });

  it("END-TO-END: bullet content actually lands in a body placeholder (not dropped)", async () => {
    const deck = parseMd("# 提案\n## 副題テキスト\n\n---\n\n# 背景\n\n- 要点アルファ\n- 要点ベータ\n");
    const buf = await generatePptx(deck, tpl);
    const zip = await JSZip.loadAsync(buf);
    const slideXml = async (n: number) =>
      (await zip.file(`ppt/slides/slide${n}.xml`)?.async("string")) ?? "";

    const s1 = await slideXml(1);
    const s2 = await slideXml(2);
    // Title slide binds title + subtitle (CX title layouts DO have subTitle#1 — the user's suspicion
    // that "no subtitle slides exist" was not the cause; the cause was the body idx collision).
    expect(s1).toContain("提案");
    expect(s1).toContain("副題テキスト");
    // Content slide: the bullets must be PRESENT — before the fix they had no body target and were
    // silently dropped (bodyCount 0), which is exactly why preview didn't follow + export was empty.
    expect(s2).toContain("要点アルファ");
    expect(s2).toContain("要点ベータ");
  });

  it("generates one slide per deck slide, no crash (end-to-end)", async () => {
    const deck = parseMd("# 表紙\n\n---\n\n# 内容\n\n- A\n- B\n\n---\n\n# まとめ\n");
    const buf = await generatePptx(deck, tpl);
    const zip = await JSZip.loadAsync(buf);
    const slides = Object.keys(zip.files).filter((f) => /ppt\/slides\/slide\d+\.xml$/.test(f));
    expect(slides.length).toBe(deck.slides.length);
  });
});
