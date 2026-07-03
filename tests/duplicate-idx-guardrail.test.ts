/**
 * duplicate-idx-guardrail.test.ts — a (defective) template may reuse a placeholder idx within one
 * layout. OOXML requires idx unique per layout (PowerPoint itself mis-binds duplicates), and our
 * binding assumes uniqueness — a duplicate makes buildFieldMap NON-injective (a 1:1 break). The loader
 * must de-dupe so the app stays robust on such templates. Test case: 配布資料_公文書高密度's
 * 10_カード3列 / 09_KPI reuse idx 19/20 (カード番号3/見出し3 vs 出典/資料名スロット).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate, type TemplateData, type LayoutInfo } from "../src/engine/template-loader";
import { bindContentByRole, buildFieldMap } from "../src/engine/placeholder-binding";
import type { SlideIR } from "../src/engine/slide-schema";

const HD = resolve(__dirname, "../public/templates/slide/配布資料_公文書高密度_全レイアウト見本.pptx");

describe("duplicate placeholder idx guardrail", () => {
  let tpl: TemplateData;
  beforeAll(async () => { tpl = await loadTemplate(readFileSync(HD)); });

  it("no layout exposes duplicate placeholder idxs (loader de-dupes malformed templates)", () => {
    for (const l of tpl.layouts) {
      const idxs = l.placeholders.map((p) => p.idx);
      expect(new Set(idxs).size, `${l.name} still has duplicate idx: ${idxs.join(",")}`).toBe(idxs.length);
    }
  });

  it("the previously-broken 10_カード3列 field map is injective AND round-trips", () => {
    const layout = tpl.layouts.find((l) => l.name === "10_カード3列")!;
    expect(layout).toBeTruthy();
    const map = buildFieldMap({ layout: layout.name, placeholders: [] }, layout.placeholders);
    const cidxs = map.map((m) => m.contentIdx);
    expect(new Set(cidxs).size).toBe(cidxs.length); // injective
    const probe: SlideIR = { layout: layout.name, placeholders: map.map((m, i) => ({ idx: m.contentIdx, paragraphs: [{ segments: [{ text: ` ${i}` }] }] })) };
    const b = bindContentByRole(probe, layout.placeholders);
    map.forEach((m, i) => expect(b.get(m.phIdx)?.paragraphs[0]?.segments[0]?.text).toBe(` ${i}`));
  });

  it("de-dupe keeps the FIRST occurrence (deterministic)", () => {
    // 配布資料's 10_カード3列 doc order puts カード番号3@19 before 出典@19 → the number ph is kept.
    const layout = tpl.layouts.find((l) => l.name === "10_カード3列")!;
    const p19 = layout.placeholders.filter((p: LayoutInfo["placeholders"][number]) => p.idx === "19");
    expect(p19.length).toBe(1);
  });
});
