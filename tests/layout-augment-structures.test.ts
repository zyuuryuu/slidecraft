/**
 * layout-augment-structures.test.ts — #568 段 3: マスター強化に「比較・カード 3 枚・KPI 行（×3／×4）」を足す。
 *
 * 段 2（2 列・3 列）と同じ枠組み（計画 → 合成 → 検査ゲート）で、本文 1 枠を「見出し＋本文」の組 ×N に分ける。
 * 受け入れ条件（Issue #568 段 3・統括の起動プロンプト）:
 *  - 幾何は BUILTIN_LAYOUTS の LayoutDef から導く（R8・第 2 の幾何定義を作らない）— 一致テストで固定
 *  - 検査ゲート (a) 既存レイアウト不変 (b) 新レイアウトが意図した group 種×数 (c) 1:1 全単射 を構造ごとに
 *  - 無い構造だけを作る・元にできないテンプレは理由付き（never-silent）
 *  - 該当する group 指定のスライド（`<!-- card -->` 等）が新レイアウトへ振り分けられる
 *  - 既定（structures 省略）は段 2 と同じ 2 列・3 列だけ（段 2 の golden・GUI 以外の呼び出しは byte-identical）
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate, autoSelectLayout, type LayoutInfo, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";
import { resolveBinding, buildFieldMap } from "../src/engine/placeholder-binding";
import { BUILTIN_LAYOUTS } from "../src/engine/template-layout-library";
import { detectGroups } from "../src/engine/group-layout";
import { planAugmentation } from "../src/engine/layout-augment-plan";
import { augmentAndVerify, type AugmentResult } from "../src/engine/layout-augment";
import {
  ALL_AUGMENT_STRUCTURES,
  GROUP_STRUCTURES,
  structureGeometry,
  type AugmentStructure,
} from "../src/engine/layout-augment-structures";
import { columnFontSize } from "../src/engine/column-font-shrink";
import { parseMd } from "../src/engine/md-parser";
import type { SlideIR } from "../src/engine/slide-schema";

const DIR = resolve(__dirname, "fixtures/templates");
const bytesOf = (f: string) => new Uint8Array(readFileSync(resolve(DIR, f)));

const MIDNIGHT = "Midnight_Executive_30_TemplateOnly.pptx";
const KOBUN = "配布資料_公文書高密度_全レイアウト見本.pptx";
const MAGAZINE = "ビジュアルデッキ_マガジン_全レイアウト見本.pptx";
const TECH = "技術報告_スタンダード水色_全レイアウト見本.pptx";
const DIRTY = "Dirty_AllBody_TemplateOnly.pptx";
// The 4 fixtures of stage 1/2 already carry compare / card / KPI×3 layouts (only KPI×4 is new there), so
// three committed masters that lack them make every structure synthesize: velis (plain English names, 2
// masters), Dirty_Grouped (all six), Dirty_Legacy43 (idx 1..9 runs out → KPI×4 uses idx 17/18, type="body").
const VELIS = "lrk-slides-velis_CC0.pptx";
const GROUPED = "Dirty_Grouped_TemplateOnly.pptx";
const LEGACY = "Dirty_Legacy43_TemplateOnly.pptx";
const FILES = [MIDNIGHT, KOBUN, MAGAZINE, TECH, VELIS, GROUPED, LEGACY];

const def = (name: string) => {
  const d = BUILTIN_LAYOUTS.find((x) => x.name === name);
  if (!d) throw new Error(name);
  return d;
};
const ph = (defName: string, phName: string) => def(defName).placeholders.find((p) => p.name === phName)!;

const text = (c: { paragraphs: { segments: { text: string }[] }[] } | undefined) => c?.paragraphs[0]?.segments[0]?.text ?? "";
const hasCtr = (l: LayoutInfo) => l.placeholders.some((p) => p.type.toLowerCase().includes("ctrtitle"));

/** The 3 bijection checks of tests/field-map-bijection.test.ts, on one layout. */
function expectBijection(layout: LayoutInfo) {
  const seed: SlideIR = { layout: layout.name, placeholders: hasCtr(layout) ? [{ idx: "0", paragraphs: [{ segments: [{ text: "T" }] }] }] : [] };
  const map = buildFieldMap(seed, layout.placeholders);
  const bound = (s: SlideIR) => new Map(resolveBinding(s, layout.placeholders).assignments.map((a) => [a.placeholder.idx, a.content.content] as const));
  expect(new Set(map.map((m) => m.contentIdx)).size, `${layout.name}: content idxs not unique`).toBe(map.length);
  const full = bound({ layout: layout.name, placeholders: map.map((m, i) => ({ idx: m.contentIdx, paragraphs: [{ segments: [{ text: ` ${i}` }] }] })) });
  map.forEach((m, i) => expect(text(full.get(m.phIdx)), `${layout.name}: ${m.phIdx} round-trip`).toBe(` ${i}`));
  for (const slot of map) {
    const b = bound({ layout: layout.name, placeholders: [{ idx: slot.contentIdx, paragraphs: [{ segments: [{ text: "S" }] }] }] });
    expect(text(b.get(slot.phIdx)), `${layout.name}: ${slot.phIdx} alone`).toBe("S");
    for (const o of map) if (o.phIdx !== slot.phIdx) expect(text(b.get(o.phIdx))).not.toBe("S");
  }
}

const results = new Map<string, { before: TemplateData; after: TemplateData; r: AugmentResult }>();

beforeAll(async () => {
  for (const f of FILES) {
    const src = bytesOf(f);
    const r = await augmentAndVerify(src, { structures: ALL_AUGMENT_STRUCTURES });
    results.set(f, { before: await loadTemplate(src), after: await loadTemplate(r.bytes), r });
  }
});

describe("geometry derives from LayoutDef (R8: no second geometry definition)", () => {
  const span = (headName: string, bodyName: string, d: string) => {
    const h = ph(d, headName);
    const b = ph(d, bodyName);
    return { h, b, total: b.y + b.h - h.y };
  };

  it("compare-2: gutter, heading height and gap from Compare.2Option.Versus", () => {
    const { h, b, total } = span("OptionLabel1.Left", "OptionContent1.Left", "Compare.2Option.Versus");
    const right = ph("Compare.2Option.Versus", "OptionLabel2.Right");
    const g = structureGeometry("compare-2");
    expect(g.gutterRatio).toBeCloseTo((right.x - (h.x + h.w)) / (right.x + right.w - h.x), 10);
    expect(g.headRatio).toBeCloseTo(h.h / total, 10);
    expect(g.gapRatio).toBeCloseTo((b.y - (h.y + h.h)) / total, 10);
    expect(g.headScale).toBeCloseTo(h.fontSize / b.fontSize, 10);
    expect(g.headBold).toBe(h.bold);
  });

  it("kpi-3 / kpi-4: value + label split and gutter from KPI.3Value.Equal (no 1-row ×4 LayoutDef exists)", () => {
    const { h, b, total } = span("Value1", "Label1", "KPI.3Value.Equal");
    const v2 = ph("KPI.3Value.Equal", "Value2");
    const v3 = ph("KPI.3Value.Equal", "Value3");
    for (const s of ["kpi-3", "kpi-4"] as const) {
      const g = structureGeometry(s);
      expect(g.gutterRatio).toBeCloseTo((v2.x - (h.x + h.w)) / (v3.x + v3.w - h.x), 10);
      expect(g.headRatio).toBeCloseTo(h.h / total, 10);
      expect(g.gapRatio).toBeCloseTo((b.y - (h.y + h.h)) / total, 10);
      expect(g.headScale).toBeCloseTo(h.fontSize / b.fontSize, 10);
      expect(g.headPtPerInch).toBeCloseTo(h.fontSize / h.w, 10);
      expect(g.align).toBe("ctr");
    }
  });

  it("card-3: horizontal from Column.3Body.Equal, heading/body split from Compare.2Option.Versus (no card LayoutDef with heading+body)", () => {
    const c1 = ph("Column.3Body.Equal", "Body1.Left");
    const cols = def("Column.3Body.Equal").placeholders.filter((p) => p.idx >= 1 && p.idx <= 9).sort((a, b) => a.x - b.x);
    const last = cols[cols.length - 1];
    const g = structureGeometry("card-3");
    expect(g.gutterRatio).toBeCloseTo((cols[1].x - (c1.x + c1.w)) / (last.x + last.w - c1.x), 10);
    const cmp = structureGeometry("compare-2");
    expect([g.headRatio, g.gapRatio, g.headScale, g.headBold]).toEqual([cmp.headRatio, cmp.gapRatio, cmp.headScale, cmp.headBold]);
  });

  it("every group structure names a real LayoutDef", () => {
    for (const spec of Object.values(GROUP_STRUCTURES)) {
      expect(() => def(spec.gutterFrom)).not.toThrow();
      expect(() => def(spec.slotsFrom)).not.toThrow();
    }
  });
});

describe("planAugmentation — structures option", () => {
  it("default (no structures) is stage 2: columns only", async () => {
    const tpl = await loadTemplate(bytesOf(TECH));
    const plan = planAugmentation(tpl, buildCatalog(tpl));
    expect(plan.add.every((a) => a.structure.startsWith("columns-"))).toBe(true);
  });

  it("only the requested structures are planned, in the canonical order", async () => {
    const tpl = await loadTemplate(bytesOf(TECH));
    const plan = planAugmentation(tpl, buildCatalog(tpl), { structures: ["kpi-4", "compare-2"] });
    const asked = plan.add.map((a) => a.structure).concat(plan.skipped.map((s) => s.structure));
    expect(asked.sort()).toEqual(["compare-2", "kpi-4"]);
    const order = plan.add.map((a) => ALL_AUGMENT_STRUCTURES.indexOf(a.structure));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("a structure the template already has is skipped with the existing layout named", async () => {
    for (const f of FILES) {
      const { before } = results.get(f)!;
      const cat = buildCatalog(before);
      const plan = results.get(f)!.r.plan;
      for (const s of plan.skipped) {
        const spec = GROUP_STRUCTURES[s.structure as keyof typeof GROUP_STRUCTURES];
        if (!spec) continue;
        const have = cat.find((e) => e.groupKind === spec.kind && e.groupCount === spec.count);
        expect(have, `${f}: ${s.structure} skipped without an existing layout`).toBeDefined();
        expect(s.reason).toContain(have!.name);
      }
      for (const a of plan.add) {
        const spec = GROUP_STRUCTURES[a.structure as keyof typeof GROUP_STRUCTURES];
        if (spec) expect(cat.some((e) => e.groupKind === spec.kind && e.groupCount === spec.count), `${f}: ${a.structure} added though present`).toBe(false);
      }
    }
  });

  it("Dirty_AllBody: every structure skipped with the base reason (never-silent)", async () => {
    const tpl = await loadTemplate(bytesOf(DIRTY));
    const plan = planAugmentation(tpl, buildCatalog(tpl), { structures: ALL_AUGMENT_STRUCTURES });
    expect(plan.add).toEqual([]);
    expect(plan.reason).toBeTruthy();
    expect(plan.skipped.length).toBeGreaterThan(0);
    for (const s of plan.skipped) expect(s.reason).toBeTruthy();
  });
});

describe("augmentAndVerify — gates per structure", () => {
  for (const f of FILES) {
    it(`${f}: the gate passes and at least one group structure is added`, () => {
      const { r } = results.get(f)!;
      expect(r.failures).toEqual([]);
      expect(r.applied).toBe(true);
      expect(r.added.some((a) => a.structure in GROUP_STRUCTURES)).toBe(true);
    });

    it(`${f}: (a) existing layouts unchanged`, () => {
      const { before, after } = results.get(f)!;
      for (let i = 0; i < before.layouts.length; i++) expect(JSON.stringify(after.layouts[i])).toBe(JSON.stringify(before.layouts[i]));
    });

    it(`${f}: (b) each new group layout is detected as the intended kind × count with a title, (c) bijection`, () => {
      const { after, r } = results.get(f)!;
      const cat = buildCatalog(after);
      for (const a of r.added) {
        const spec = GROUP_STRUCTURES[a.structure as keyof typeof GROUP_STRUCTURES];
        const l = after.layouts.find((x) => x.name === a.name)!;
        const e = cat.find((x) => x.name === a.name)!;
        expect(e.hasTitle, a.name).toBe(true);
        if (spec) {
          expect([e.groupKind, e.groupCount], a.name).toEqual([spec.kind, spec.count]);
          const shape = detectGroups(l)!;
          expect(shape.groups.every((g) => g.map((s) => s.role).join("|") === "heading|body"), a.name).toBe(true);
        }
        expectBijection(l);
      }
    });

    it(`${f}: idempotent — augmenting again adds nothing`, async () => {
      const again = await augmentAndVerify(results.get(f)!.r.bytes, { structures: ALL_AUGMENT_STRUCTURES });
      expect(again.added).toEqual([]);
      expect(again.applied).toBe(false);
    });
  }
});

const GROUP_MD: Record<string, string> = {
  "compare-2": "# 比較\n\n<!-- compare -->\n### A 案\n- 速い\n\n<!-- compare -->\n### B 案\n- 安い",
  "card-3": "# カード\n\n<!-- card -->\n### 収集\n- あ\n\n<!-- card -->\n### 分析\n- い\n\n<!-- card -->\n### 運用\n- う",
  "kpi-3": "# KPI\n\n<!-- kpi -->\n### 98%\n- 稼働率\n\n<!-- kpi -->\n### 1.2 秒\n- 応答\n\n<!-- kpi -->\n### 30 件\n- 障害",
  "kpi-4": "# KPI\n\n<!-- kpi -->\n### 1\n- a\n\n<!-- kpi -->\n### 2\n- b\n\n<!-- kpi -->\n### 3\n- c\n\n<!-- kpi -->\n### 4\n- d",
};

describe("coverage — every group structure is synthesized (and gated) on at least one committed fixture", () => {
  it("compare-2 / card-3 / kpi-3 / kpi-4 each appear in some fixture's added list", () => {
    const seen = new Set([...results.values()].flatMap((x) => x.r.added.map((a) => a.structure)));
    for (const s of Object.keys(GROUP_STRUCTURES)) expect(seen.has(s as AugmentStructure), s).toBe(true);
  });
  it("Dirty_Legacy43 KPI×4 runs past idx 9 into 17+ (never 10..16 / 50)", () => {
    const a = results.get(LEGACY)!.r.added.find((x) => x.structure === "kpi-4")!;
    expect(a.idxs.some((i) => Number(i) >= 17)).toBe(true);
    expect(a.idxs.every((i) => !(Number(i) >= 10 && Number(i) <= 16) && i !== "50")).toBe(true);
  });
});

describe("routing — a group slide lands on the synthesized layout", () => {
  for (const f of FILES) {
    it(`${f}: each added group structure receives its group slide (exact count)`, () => {
      const { after, r } = results.get(f)!;
      const cat = buildCatalog(after);
      for (const a of r.added) {
        const md = GROUP_MD[a.structure];
        if (!md) continue;
        const slide = parseMd(`# 表紙\n\n---\n\n${md}`).slides[1];
        expect(autoSelectLayout(slide, 1, 2, cat), `${f}: ${a.structure}`).toBe(a.name);
      }
    });
  }
});

describe("font sizes and style come from the shrink rule + LayoutDef ratios", () => {
  for (const f of [TECH, GROUPED, VELIS]) it(`${f}: body slots shrink like columns (count clamped to 3), headings = body × LayoutDef ratio (0.5pt floor), bold; KPI centred`, () => {
    const { after, r } = results.get(f)!;
    const src = r.plan.base!.sourceSizes; // 16/14/12/10
    for (const a of r.added) {
      const spec = GROUP_STRUCTURES[a.structure as keyof typeof GROUP_STRUCTURES];
      if (!spec) continue;
      const n = Math.min(spec.count, 3) as 2 | 3;
      const body = src.map((pt, i) => columnFontSize(pt, n, r.plan.rule, i + 1));
      expect(a.levelSizes, a.structure).toEqual(body);
      const g = structureGeometry(a.structure as AugmentStructure);
      // heading = body × LayoutDef ratio, capped by LayoutDef's heading pt-per-inch × the column width (never below body)
      const box = r.plan.base!.box;
      const colW = (box.w - box.w * g.gutterRatio * (spec.count - 1)) / spec.count;
      const head = Math.max(body[0], Math.floor(Math.min(body[0] * g.headScale, g.headPtPerInch * colW) * 2 + 1e-9) / 2);
      expect(a.group?.headSize, a.structure).toBe(head);
      const l = after.layouts.find((x) => x.name === a.name)!;
      const byIdx = new Map(l.placeholders.map((p) => [p.idx, p] as const));
      const [h1, b1] = [byIdx.get(a.idxs[0])!, byIdx.get(a.idxs[1])!];
      expect(h1.style.fontSize, `${a.structure} heading`).toBe(head);
      expect(h1.style.bold, `${a.structure} heading bold`).toBe(true);
      expect(b1.style.fontSize, `${a.structure} body`).toBe(body[0]);
      if (spec.kind === "kpi") expect([h1.style.align, b1.style.align], a.structure).toEqual(["ctr", "ctr"]);
    }
  });

  for (const f of [TECH, GROUPED, VELIS]) it(`${f}: geometry — the synthesized boxes follow the derived ratios inside the base body box (±1%)`, () => {
    const { after, r } = results.get(f)!;
    const box = r.plan.base!.box;
    for (const a of r.added) {
      const spec = GROUP_STRUCTURES[a.structure as keyof typeof GROUP_STRUCTURES];
      if (!spec) continue;
      const g = structureGeometry(a.structure as AugmentStructure);
      const l = after.layouts.find((x) => x.name === a.name)!;
      const s = (i: number) => l.placeholders.find((p) => p.idx === a.idxs[i])!.style;
      const gut = box.w * g.gutterRatio;
      const w = (box.w - gut * (spec.count - 1)) / spec.count;
      const tol = 0.01 * box.w;
      expect(Math.abs(s(0).w - w), `${a.structure} width`).toBeLessThan(tol);
      expect(Math.abs(s(2).x - (box.x + w + gut)), `${a.structure} 2nd x`).toBeLessThan(tol);
      expect(Math.abs(s(0).h - box.h * g.headRatio), `${a.structure} head h`).toBeLessThan(0.01 * box.h);
      expect(Math.abs(s(1).y - (box.y + box.h * (g.headRatio + g.gapRatio))), `${a.structure} body y`).toBeLessThan(0.01 * box.h);
      expect(Math.abs(s(1).y + s(1).h - (box.y + box.h)), `${a.structure} body bottom`).toBeLessThan(0.01 * box.h);
    }
  });
});

describe("naming", () => {
  it("plain-name masters: `<base> +2Compare` / `+3Card` / `+3KPI` / `+4KPI`; dotted masters: canonical family names", () => {
    for (const f of [KOBUN, MAGAZINE, TECH, VELIS, GROUPED, LEGACY]) {
      const { r } = results.get(f)!;
      const suffix: Record<string, string> = { "compare-2": "+2Compare", "card-3": "+3Card", "kpi-3": "+3KPI", "kpi-4": "+4KPI" };
      for (const a of r.added) if (suffix[a.structure]) expect(a.name).toBe(`${r.plan.base!.layoutName} ${suffix[a.structure]}`);
    }
    const mid = results.get(MIDNIGHT)!.r;
    const canon: Record<string, RegExp> = { "compare-2": /^Compare\.2Option\./, "card-3": /^Summary\.3Block\./, "kpi-3": /^KPI\.3Value\./, "kpi-4": /^KPI\.4Value\./ };
    for (const a of mid.added) if (canon[a.structure]) expect(a.name).toMatch(canon[a.structure]);
  });
});
