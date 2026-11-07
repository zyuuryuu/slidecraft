/**
 * layout-augment.test.ts — #568 段 2: マスター強化（レイアウト合成）。
 *
 * 既存マスターの基本レイアウト（title＋本文 1 枠）を複製して本文枠を N 列に分け、そのテンプレに無い N 列
 * レイアウトだけを足す。統括裁定（Issue #568 コメント 2026-11-07）の受け入れ条件:
 *  (a) 既存レイアウトの LayoutInfo と catalog が合成前と同一（既存パーツは byte-identical）
 *  (b) 新レイアウトのロールが columns×N
 *  (c) 1:1 全単射（field-map-bijection.test.ts と同じ 3 検査）
 *  (d) 3 列スライドが新レイアウトに振り分けられる
 *  (e) 無い N だけを作る
 *  (f) Dirty_AllBody は理由付きで合成しない（never-silent）
 *  (g) lstStyle の pt が規則どおり（steps / ratio）
 *  (h) 冪等（2 回目は何も足さない・同じ入力から同じ bytes）
 *  ＋ 列のガター比率が LayoutDef（template-layout-library.ts）と一致（R8）
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { loadTemplate, autoSelectLayout, type LayoutInfo, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog, placeholderRole, isContentBody } from "../src/engine/template-catalog";
import { resolveBinding, buildFieldMap } from "../src/engine/placeholder-binding";
import { BUILTIN_LAYOUTS } from "../src/engine/template-layout-library";
import { planAugmentation, augmentedLayoutName } from "../src/engine/layout-augment-plan";
import { augmentTemplate, augmentAndVerify, verifyAugmentation } from "../src/engine/layout-augment";
import { columnFontSize, stepDown } from "../src/engine/column-font-shrink";
import type { SlideIR } from "../src/engine/slide-schema";

const DIR = resolve(__dirname, "fixtures/templates");
const bytesOf = (f: string) => new Uint8Array(readFileSync(resolve(DIR, f)));

const MIDNIGHT = "Midnight_Executive_30_TemplateOnly.pptx";
const KOBUN = "配布資料_公文書高密度_全レイアウト見本.pptx";
const MAGAZINE = "ビジュアルデッキ_マガジン_全レイアウト見本.pptx";
const TECH = "技術報告_スタンダード水色_全レイアウト見本.pptx";

// Expected per fixture (Issue #568 段 1 の実測表＋推奨 2/3）: base layout and which N get synthesized.
const CASES: Array<{ file: string; base: string; add: number[] }> = [
  { file: MIDNIGHT, base: "Content.1Body.Single", add: [] },
  { file: KOBUN, base: "08_目次", add: [3] },
  { file: MAGAZINE, base: "08_目次", add: [3] },
  { file: TECH, base: "02_本文（1カラム）", add: [3] },
];

const text = (c: { paragraphs: { segments: { text: string }[] }[] } | undefined) => c?.paragraphs[0]?.segments[0]?.text ?? "";
const hasCtr = (l: LayoutInfo) => l.placeholders.some((p) => p.type.toLowerCase().includes("ctrtitle"));
const boundText = (slide: SlideIR, l: LayoutInfo) =>
  new Map(resolveBinding(slide, l.placeholders).assignments.map((a) => [a.placeholder.idx, a.content.content] as const));

/** The 3 bijection checks of tests/field-map-bijection.test.ts, on one layout. */
function expectBijection(layout: LayoutInfo) {
  const seed: SlideIR = { layout: layout.name, placeholders: hasCtr(layout) ? [{ idx: "0", paragraphs: [{ segments: [{ text: "T" }] }] }] : [] };
  const map = buildFieldMap(seed, layout.placeholders);
  const cidxs = map.map((m) => m.contentIdx);
  expect(new Set(cidxs).size, `${layout.name}: content idxs not unique`).toBe(cidxs.length);
  const full: SlideIR = { layout: layout.name, placeholders: map.map((m, i) => ({ idx: m.contentIdx, paragraphs: [{ segments: [{ text: ` ${i}` }] }] })) };
  const bound = boundText(full, layout);
  map.forEach((m, i) => expect(text(bound.get(m.phIdx)), `${layout.name}: ${m.phIdx} round-trip`).toBe(` ${i}`));
  for (const slot of map) {
    const solo: SlideIR = { layout: layout.name, placeholders: [{ idx: slot.contentIdx, paragraphs: [{ segments: [{ text: "S" }] }] }] };
    const b = boundText(solo, layout);
    expect(text(b.get(slot.phIdx)), `${layout.name}: ${slot.phIdx} alone`).toBe("S");
    for (const other of map) if (other.phIdx !== slot.phIdx) expect(text(b.get(other.phIdx))).not.toBe("S");
  }
}

const stripVolatile = (l: LayoutInfo) => JSON.stringify(l);

const results = new Map<string, { before: TemplateData; after: TemplateData; src: Uint8Array; out: Uint8Array; added: Awaited<ReturnType<typeof augmentTemplate>>["added"] }>();

beforeAll(async () => {
  for (const c of CASES) {
    const src = bytesOf(c.file);
    const before = await loadTemplate(src);
    const plan = planAugmentation(before, buildCatalog(before));
    const { bytes, added } = await augmentTemplate(src, plan);
    results.set(c.file, { before, after: await loadTemplate(bytes), src, out: bytes, added });
  }
});

describe("planAugmentation — base layout and the N to add (axes 2/3 of #568)", () => {
  for (const c of CASES) {
    it(`${c.file}: base = ${c.base}, adds ${JSON.stringify(c.add)}`, async () => {
      const tpl = await loadTemplate(bytesOf(c.file));
      const plan = planAugmentation(tpl, buildCatalog(tpl));
      expect(plan.base?.layoutName).toBe(c.base);
      expect(plan.add.map((a) => a.columns)).toEqual(c.add); // (e) only the N the template lacks
      for (const n of [2, 3].filter((n) => !c.add.includes(n)))
        expect(plan.skipped.find((s) => s.columns === n)?.reason, `N=${n} skip reason`).toBeTruthy();
    });
  }

  it("(f) Dirty_AllBody: no base candidate → nothing to add, with a reason (never-silent)", async () => {
    const tpl = await loadTemplate(bytesOf("Dirty_AllBody_TemplateOnly.pptx"));
    const plan = planAugmentation(tpl, buildCatalog(tpl));
    expect(plan.base).toBeUndefined();
    expect(plan.add).toEqual([]);
    expect(plan.reason).toMatch(/タイトル/);
    const r = await augmentAndVerify(bytesOf("Dirty_AllBody_TemplateOnly.pptx"));
    expect(r.applied).toBe(false);
    expect(r.reason).toBe(plan.reason);
  });
});

describe("augmentTemplate — the gates (a)(b)(c)", () => {
  for (const c of CASES) {
    it(`${c.file}: (a) existing layouts' LayoutInfo + catalog unchanged, existing layout parts byte-identical`, async () => {
      const r = results.get(c.file)!;
      const n = r.before.layouts.length;
      expect(r.after.layouts.length).toBe(n + c.add.length);
      for (let i = 0; i < n; i++) expect(stripVolatile(r.after.layouts[i])).toBe(stripVolatile(r.before.layouts[i]));
      expect(JSON.stringify(buildCatalog(r.after).slice(0, n))).toBe(JSON.stringify(buildCatalog(r.before)));
      const zin = await JSZip.loadAsync(r.src);
      const zout = await JSZip.loadAsync(r.out);
      const changed: string[] = [];
      for (const p of Object.keys(zin.files)) {
        if (zin.files[p].dir) continue;
        if ((await zin.file(p)!.async("string")) !== (await zout.file(p)!.async("string"))) changed.push(p);
      }
      // Only the master's layout list, its rels and the content-type overrides may change (additions only).
      if (c.add.length === 0) expect(changed).toEqual([]);
      else expect(changed.sort()).toEqual(["[Content_Types].xml", "ppt/slideMasters/_rels/slideMaster1.xml.rels", "ppt/slideMasters/slideMaster1.xml"]);
    });

    if (c.add.length === 0) continue;

    it(`${c.file}: (b) each new layout is role columns × N, (c) its field map is a 1:1 bijection`, () => {
      const r = results.get(c.file)!;
      const cat = buildCatalog(r.after);
      expect(r.added.map((a) => a.columns)).toEqual(c.add);
      for (const a of r.added) {
        const e = cat.find((x) => x.name === a.name)!;
        expect(e, a.name).toBeDefined();
        expect(e.role).toBe("columns");
        expect(e.bodyCount).toBe(a.columns);
        expect(e.hasTitle).toBe(true);
        expectBijection(r.after.layouts.find((l) => l.name === a.name)!);
      }
      expect(verifyAugmentation(r.before, r.after, r.added)).toEqual([]);
    });

    it(`${c.file}: (d) a 3-column slide now resolves to the synthesized layout`, () => {
      const r = results.get(c.file)!;
      const body = (idx: string, t: string) => ({ idx, paragraphs: [{ segments: [{ text: t }] }] });
      const slide: SlideIR = { layout: "auto", placeholders: [body("15", "T"), body("1", "a"), body("2", "b"), body("3", "c")] };
      const name3 = r.added.find((a) => a.columns === 3)!.name;
      expect(autoSelectLayout(slide, 1, 3, buildCatalog(r.before))).not.toBe(name3);
      expect(autoSelectLayout(slide, 1, 3, buildCatalog(r.after))).toBe(name3);
      // left-to-right column order == body ordinal order (content idx 1/2/3 land in the boxes left→right)
      const l = r.after.layouts.find((x) => x.name === name3)!;
      const bound = boundText(slide, l);
      const xs = ["a", "b", "c"].map((t) => l.placeholders.find((p) => text(bound.get(p.idx)) === t)!.style.x);
      expect([...xs].sort((p, q) => p - q)).toEqual(xs);
    });

    it(`${c.file}: column gutter ratio == LayoutDef's Column.${c.add[0]}Body.Equal (R8)`, () => {
      const r = results.get(c.file)!;
      for (const a of r.added) {
        const def = BUILTIN_LAYOUTS.find((d) => d.name === `Column.${a.columns}Body.Equal`)!;
        const cols = def.placeholders.filter((p) => /^Body\d/.test(p.name)).sort((p, q) => p.x - q.x);
        const defRatio = (cols[1].x - (cols[0].x + cols[0].w)) / (cols.at(-1)!.x + cols.at(-1)!.w - cols[0].x);
        const boxes = r.after.layouts.find((l) => l.name === a.name)!.placeholders.filter(isContentBody).map((p) => p.style).sort((p, q) => p.x - q.x);
        const total = boxes.at(-1)!.x + boxes.at(-1)!.w - boxes[0].x;
        for (let i = 1; i < boxes.length; i++) {
          expect((boxes[i].x - (boxes[i - 1].x + boxes[i - 1].w)) / total).toBeCloseTo(defRatio, 3);
          expect(boxes[i].w).toBeCloseTo(boxes[0].w, 3); // equal widths
        }
      }
    });
  }

  it("verifyAugmentation rejects a mismatch (b): a 3-body layout claimed as 2 columns", () => {
    const r = results.get(TECH)!;
    const wrong = r.added.map((a) => ({ ...a, columns: 2 as const }));
    expect(verifyAugmentation(r.before, r.after, wrong).join("\n")).toMatch(/columns|body/);
  });

  it("verifyAugmentation rejects (a): an existing layout that changed", () => {
    const r = results.get(TECH)!;
    expect(verifyAugmentation(results.get(MAGAZINE)!.before, r.after, r.added).length).toBeGreaterThan(0);
  });
});

describe("(g) lstStyle font sizes follow the shrink rule", () => {
  it("rule constants: the PowerPoint ladder −1/−2 steps and ×0.875/×0.75, 0.5pt, lvl1 floor 9", () => {
    expect(stepDown(14, 1)).toBe(12);
    expect(stepDown(14, 2)).toBe(11);
    expect(stepDown(16, 2)).toBe(12);
    expect(stepDown(12, 2)).toBe(10.5);
    expect(stepDown(12.32, 1)).toBe(12);
    expect(columnFontSize(20, 3, "steps", 1)).toBe(16);
    expect(columnFontSize(20, 2, "ratio", 1)).toBe(17.5);
    expect(columnFontSize(14, 3, "ratio", 1)).toBe(10.5);
    expect(columnFontSize(10, 3, "steps", 1)).toBe(9); // lvl1 floor
    expect(columnFontSize(10, 3, "steps", 2)).toBe(8); // floor is lvl1-only
    expect(columnFontSize(8.5, 3, "steps", 1)).toBe(8.5); // never grows past the source
  });

  for (const rule of ["steps", "ratio"] as const) {
    it(`技術報告 3 列 (${rule}): lvl1..4 = rule(16/14/12/10) as the loader reads it back`, async () => {
      const src = bytesOf(TECH);
      const tpl = await loadTemplate(src);
      const plan = planAugmentation(tpl, buildCatalog(tpl), { rule });
      const expected = [16, 14, 12, 10].map((pt, i) => columnFontSize(pt, 3, rule, i + 1));
      expect(expected).toEqual(rule === "steps" ? [12, 11, 10.5, 8] : [12, 10.5, 9, 7.5]);
      expect(plan.add[0].levelSizes).toEqual(expected);
      const after = await loadTemplate((await augmentTemplate(src, plan)).bytes);
      for (const p of after.layouts.find((l) => l.name === plan.add[0].name)!.placeholders.filter(isContentBody)) {
        expect(p.style.fontSize).toBe(expected[0]);
        expect(p.style.levelFontSizes).toEqual(expected.slice(1));
      }
    });
  }

  it("マガジン 3 列 steps: lvl1 20pt → 16pt", () => {
    const r = results.get(MAGAZINE)!;
    const l = r.after.layouts.find((x) => x.name === r.added[0].name)!;
    for (const p of l.placeholders.filter(isContentBody)) expect(p.style.fontSize).toBe(16);
  });
});

describe("(h) idempotent + deterministic", () => {
  for (const c of [KOBUN, TECH]) {
    it(`${c}: augmenting the augmented template adds nothing and returns the same bytes`, async () => {
      const r = results.get(c)!;
      const plan2 = planAugmentation(r.after, buildCatalog(r.after));
      expect(plan2.add).toEqual([]);
      const again = await augmentTemplate(r.out, plan2);
      expect(again.added).toEqual([]);
      expect(Buffer.from(again.bytes).equals(Buffer.from(r.out))).toBe(true);
    });
    it(`${c}: the same input yields byte-identical output`, async () => {
      const r = results.get(c)!;
      const plan = planAugmentation(r.before, buildCatalog(r.before));
      const second = await augmentTemplate(r.src, plan);
      expect(Buffer.from(second.bytes).equals(Buffer.from(r.out))).toBe(true);
    });
  }

  it("augmentAndVerify applies (gate passes) and reports what was added", async () => {
    const r = await augmentAndVerify(bytesOf(TECH));
    expect(r.applied).toBe(true);
    expect(r.failures).toEqual([]);
    expect(r.added.map((a) => a.name)).toEqual(["02_本文（1カラム） +3Body"]);
  });
});

describe("naming — dotted-convention masters get a canonical Column.* name (classifyLayout T1)", () => {
  it("plain names: `<base> +NBody`; dotted names: Column.NBody.Equal (fallback when taken)", () => {
    expect(augmentedLayoutName("02_本文（1カラム）", 3, [])).toBe("02_本文（1カラム） +3Body");
    expect(augmentedLayoutName("Content.1Body.Single", 3, [])).toBe("Column.3Body.Equal");
    expect(augmentedLayoutName("Content.1Body.Single", 2, ["Column.2Body.Equal"])).toBe("Column.2Body.Augmented");
  });

  it("new layout names are written to BOTH <p:cSld name> and the non-standard sldLayout@name", async () => {
    const r = results.get(TECH)!;
    const zout = await JSZip.loadAsync(r.out);
    const xml = await zout.file(r.added[0].part)!.async("string");
    expect(xml.match(/<p:sldLayout\b[^>]*\sname="([^"]*)"/)?.[1]).toBe(r.added[0].name);
    expect(xml.match(/<p:cSld name="([^"]*)"/)?.[1]).toBe(r.added[0].name);
    const ids = [...xml.matchAll(/<p:cNvPr id="(\d+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length); // cNvPr ids unique within the layout
    // the placeholder role of every column is body (idx 1..9 typeless, or ≥17 with type="body")
    const l = r.after.layouts.find((x) => x.name === r.added[0].name)!;
    expect(l.placeholders.filter((p) => placeholderRole(p) === "body").length).toBe(3);
  });
});
