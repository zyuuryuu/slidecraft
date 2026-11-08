/**
 * executive-preset-596.test.ts — #596（#580 段 2-d）エグゼクティブ（インパクト重視）プリセット「Executive」。
 *
 * 受け入れ基準（Issue 本文）: samples の 10 枚（manuscript-06-executive-brief.md）を Executive で出力 →
 * 10 枚のまま（自動分割ゼロ）・消失系 0・巨大 KPI と Ask 締めが意図のレイアウトに入る・本文 4 行のスライドに
 * 密度 info が 1 件（既定テンプレでは 0 件）。
 * 加えて: 出荷 .pptx と全レイアウト見本 fixture は writePresetTemplate／generatePptx から決定論的に再生成でき、
 * 中身（全パートの名前＋内容）が一致する（golden）。生成手順は scripts/make-executive-template.ts。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createHash } from "crypto";
import JSZip from "jszip";
import { EXECUTIVE_PRESET, presetToSpec, writePresetTemplate, PRESET_LIBRARY } from "../src/engine/template-presets";
import { BUILTIN_LAYOUTS } from "../src/engine/template-layout-library";
import { loadTemplate, autoSelectLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog, assessTemplateHealth, layoutRole, type LayoutCatalog } from "../src/engine/template-catalog";
import { bindContentByRole, buildFieldMap } from "../src/engine/placeholder-binding";
import { expandGroups } from "../src/engine/group-binding";
import { parseMd } from "../src/engine/md-parser";
import { distillDeck } from "../src/engine/distill";
import { generatePptx } from "../src/engine/placeholder-filler";
import { BUILTIN_MASTERS } from "../src/components/useMasterRegistry";
import * as S from "../src/mcp/session";
import type { SlideIR, PlaceholderContent } from "../src/engine/slide-schema";
import { buildExecutiveFixture, EXECUTIVE_FIXTURE_MD } from "../scripts/make-executive-template";

const ROOT = resolve(__dirname, "..");
const SHIPPED = resolve(ROOT, "public/templates/slide/エグゼクティブ_Executive_TemplateOnly.pptx");
const FIXTURE = resolve(__dirname, "fixtures/templates/エグゼクティブ_Executive_全レイアウト見本.pptx");
const SAMPLE = readFileSync(resolve(ROOT, "samples/manuscript-06-executive-brief.md"), "utf8");

/** 中身の指紋: 全パートの名前＋内容（zip のエントリ日時は含めない）。 */
async function contentDigest(bytes: Uint8Array): Promise<string> {
  const z = await JSZip.loadAsync(bytes);
  const h = createHash("sha256");
  for (const n of Object.keys(z.files).sort()) {
    if (z.files[n].dir) continue;
    h.update(n + "\0");
    h.update(await z.files[n].async("uint8array"));
    h.update("\0");
  }
  return h.digest("hex");
}

/** 書き出した PPTX の各スライドが実際に使ったレイアウト名（export の経路＝materializeDerivedSlides 込み）。 */
async function exportedLayouts(pptx: Uint8Array): Promise<string[]> {
  const z = await JSZip.loadAsync(pptx);
  const n = Object.keys(z.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).length;
  const out: string[] = [];
  for (let i = 1; i <= n; i++) {
    const rel = await z.file(`ppt/slides/_rels/slide${i}.xml.rels`)!.async("string");
    const layout = rel.match(/slideLayouts\/(slideLayout\d+\.xml)/)![1];
    out.push((await z.file(`ppt/slideLayouts/${layout}`)!.async("string")).match(/<p:cSld name="([^"]*)"/)![1]);
  }
  return out;
}

// 本文を落とす・隠す・残骸を残す系の診断（#580 段 1 の「構造の健全性」の定義）。
const LOSS_IDS = new Set([
  "unbound-content", "visual-shadowed-content", "image-markdown-leftover", "meta-key-dropped", "table-dropped",
  "image-dropped", "figure-dropped", "pre-separator-dropped", "marker-layout-missing", "unknown-layout-pin",
]);

const EXPECTED_SAMPLE_LAYOUTS = [
  "Title.1Title.Single", // 結論先出しの表紙（タイトル＋1 文の結論）
  "Statement.1Message.Single", // 1 枚 1 メッセージ
  "Content.1Body.Single+1Callout", // 要約（箇条 3 つ＋ Takeaway）
  "KPI.1Value.Single", // 巨大 KPI
  "KPI.3Value.Equal",
  "Compare.2Option.Versus",
  "Process.3Step.Sequential",
  "Column.3Body.Equal", // 3 点要約（カード 3）
  "Content.1Body.Single", // 本文 4 行（密度 info の確認用）
  "Closing.1Ask+1Decision", // Ask 締め
];

const text = (c: PlaceholderContent | undefined) => c?.paragraphs.map((p) => p.segments.map((s) => s.text).join("")).join("\n");
const boundByName = (slide: SlideIR, tpl: TemplateData, layoutName: string) => {
  const layout = tpl.layouts.find((l) => l.name === layoutName)!;
  const bound = slide.groupKind && slide.groupKind !== "statement" ? expandGroups(slide, layout) : bindContentByRole(slide, layout.placeholders);
  return (phName: string) => text(bound.get(layout.placeholders.find((p) => p.name === phName)!.idx));
};

let shipped: Uint8Array;
let tpl: TemplateData;
let catalog: LayoutCatalog;
beforeAll(async () => {
  shipped = readFileSync(SHIPPED);
  tpl = await loadTemplate(shipped);
  catalog = buildCatalog(tpl);
});

describe("EXECUTIVE_PRESET — 構成（ダーク・accent 1 色・本文 20pt・左右 1.0in・本文 3 行／45 字）", () => {
  it("密度と目標帯", () => {
    expect(EXECUTIVE_PRESET.density).toEqual({ bodyPt: 20, marginIn: 1.0, maxBodyLines: 3, maxLineChars: 45 });
  });

  it("レイアウトは Issue の構成＋汎用本文・章扉。Ask 締めはプリセット専用の定義（BUILTIN_LAYOUTS は不変）", () => {
    expect(EXECUTIVE_PRESET.layouts).toEqual([
      "Title.1Title.Single", "Statement.1Message.Single", "Content.1Body.Single", "Content.1Body.Single+1Callout",
      "KPI.1Value.Single", "KPI.3Value.Equal", "Compare.2Option.Versus", "Process.3Step.Sequential",
      "Column.2Body.Equal", "Column.3Body.Equal", "Section.1Title.Single", "SectionNav.1TitleList.Single", "Closing.1Ask+1Decision",
    ]);
    expect(BUILTIN_LAYOUTS.map((d) => d.name)).not.toContain("Closing.1Ask+1Decision");
    expect(PRESET_LIBRARY.map((d) => d.name)).toContain("Closing.1Ask+1Decision");
    expect(layoutRole("Closing.1Ask+1Decision")).toBe("closing");
  });

  it("配色はダーク（本文の地 canvas と表紙の地 background がどちらも暗い）で、本文は明るい", () => {
    const lum = (hex: string) => {
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const p = EXECUTIVE_PRESET.palette;
    expect(lum(p.canvas)).toBeLessThan(0.2);
    expect(lum(p.background)).toBeLessThan(0.2);
    expect(lum(p.bodyText)).toBeGreaterThan(0.6);
    expect(p.emphasis).toBe(p.accent); // 大数字は accent 1 色
  });
});

describe("出荷テンプレ（public/templates/slide/エグゼクティブ_Executive_TemplateOnly.pptx）", () => {
  it("writePresetTemplate(EXECUTIVE_PRESET) と中身が一致（決定論的に再生成できる）", async () => {
    expect(await contentDigest(shipped)).toBe(await contentDigest(await writePresetTemplate(EXECUTIVE_PRESET)));
  });

  it("BUILTIN_MASTERS に登録されている（既定＝先頭は技術報告のまま）", () => {
    expect(BUILTIN_MASTERS[0].id).toBe("builtin-gijutsu");
    expect(BUILTIN_MASTERS).toContainEqual({ id: "builtin-executive", name: "エグゼクティブ Executive", url: "/templates/slide/エグゼクティブ_Executive_TemplateOnly.pptx" });
  });

  it("loader health ok・レイアウト名はプリセットどおり・目標帯をメタから読める", () => {
    expect(assessTemplateHealth(catalog).status).toBe("ok");
    expect(tpl.layouts.map((l) => l.name)).toEqual(EXECUTIVE_PRESET.layouts);
    expect(tpl.styleDensity).toEqual(EXECUTIVE_PRESET.density);
    expect(tpl.masterBodyStyle.fontSize).toBe(20);
  });

  it("Ask 締めはグループ型と誤認されない（groupKind なし・closing 役）", () => {
    const e = catalog.find((x) => x.name === "Closing.1Ask+1Decision")!;
    expect(e.role).toBe("closing");
    expect(e.groupKind).toBeUndefined();
  });

  it("全レイアウトで編集フィールドの写像が全単射（単射・往復・単独入力）", () => {
    for (const layout of tpl.layouts) {
      const map = buildFieldMap({ layout: layout.name, placeholders: [] }, layout.placeholders);
      expect(new Set(map.map((m) => m.contentIdx)).size, layout.name).toBe(map.length);
      const probe: SlideIR = { layout: layout.name, placeholders: map.map((m, i) => ({ idx: m.contentIdx, paragraphs: [{ segments: [{ text: ` ${i}` }] }] })) };
      const bound = bindContentByRole(probe, layout.placeholders);
      map.forEach((m, i) => expect(text(bound.get(m.phIdx)), `${layout.name} ${m.phIdx}`).toBe(` ${i}`));
    }
  });

  // PR #635 裁定 B: 本文倍率（20/14）は 21pt 以下の枠だけ。KPI の値（大数字）は倍率前のサイズのまま。
  it("KPI.1/KPI.3 の値枠のフォントは倍率前（LayoutDef）と同じ・ラベル枠（本文の帯）は倍率が掛かる", async () => {
    const defs = presetToSpec(EXECUTIVE_PRESET, PRESET_LIBRARY).layouts!;
    const z = await JSZip.loadAsync(shipped);
    const layoutXml = async (name: string) => {
      for (const p of Object.keys(z.files).filter((n) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(n))) {
        const xml = await z.file(p)!.async("string");
        if (xml.includes(`<p:cSld name="${name}"`)) return xml;
      }
      throw new Error(name);
    };
    const lvl1Pt = (xml: string, ph: string) =>
      Number(xml.match(new RegExp(`name="${ph.replace(/\./g, "\\.")}"(?:(?!</p:sp>).)*?<a:defRPr\\b[^>]*\\bsz="(\\d+)"`))![1]) / 100;
    const cases: [string, string[], string[]][] = [
      ["KPI.1Value.Single", ["Value.Center"], ["ValueLabel.Center"]],
      ["KPI.3Value.Equal", ["Value1", "Value2", "Value3"], ["Label1", "Label2", "Label3"]],
      ["Closing.1Ask+1Decision", ["Ask.Center"], ["Decision.Bottom"]],
    ];
    for (const [layout, values, labels] of cases) {
      const def = defs.find((d) => d.name === layout)!;
      const xml = await layoutXml(layout);
      const fs = (ph: string) => def.placeholders.find((p) => p.name === ph)!.fontSize;
      for (const ph of values) {
        expect(fs(ph), `${layout} ${ph}`).toBeGreaterThan(21);
        expect(lvl1Pt(xml, ph), `${layout} ${ph}`).toBe(fs(ph));
      }
      for (const ph of labels) {
        expect(fs(ph), `${layout} ${ph}`).toBeLessThanOrEqual(21);
        expect(lvl1Pt(xml, ph), `${layout} ${ph}`).toBe(Math.round(fs(ph) * (20 / 14) * 2) / 2);
      }
    }
  });

  it("左右余白 1.0in: 本文枠の左端が 1.0in", () => {
    const def = presetToSpec(EXECUTIVE_PRESET, PRESET_LIBRARY).layouts!.find((d) => d.name === "Content.1Body.Single")!;
    expect(def.placeholders.find((p) => p.name === "Body.Center")!.x).toBeCloseTo(1.0, 6);
  });
});

describe("受け入れ基準: samples/manuscript-06-executive-brief.md を Executive で出力", () => {
  it("10 枚のまま（自動分割ゼロ）・各スライドが意図のレイアウト（選択と書き出しの両方）", async () => {
    const deck = distillDeck(parseMd(SAMPLE), catalog);
    expect(deck.slides).toHaveLength(10);
    expect(deck.slides.map((s, i) => autoSelectLayout(s, i, deck.slides.length, catalog))).toEqual(EXPECTED_SAMPLE_LAYOUTS);
    expect(await exportedLayouts(await generatePptx(deck, tpl))).toEqual(EXPECTED_SAMPLE_LAYOUTS);
  });

  it("消失系 0・密度 info は本文 4 行のスライド（9 枚目）に 1 件だけ", async () => {
    const s = S.createSession(null);
    const r = await S.newProject(s, shipped, SAMPLE);
    expect(r.slideCount).toBe(10);
    const issues = S.getDiagnostics(s).issues;
    expect(issues.filter((i) => LOSS_IDS.has(i.id ?? ""))).toEqual([]);
    expect(issues.filter((i) => i.level === "warn")).toEqual([]);
    const density = issues.filter((i) => i.id === "density-target");
    expect(density.map((i) => [i.slideIndex, i.title])).toEqual([[8, "現場との調整状況"]]);
  });

  it("既定テンプレ（技術報告）では同じデッキに密度 info は出ない", async () => {
    const s = S.createSession(null);
    await S.newProject(s, readFileSync(resolve(ROOT, "public/templates/slide/技術報告_スタンダード水色_TemplateOnly.pptx")), SAMPLE);
    expect(S.getDiagnostics(s).issues.filter((i) => i.id === "density-target")).toEqual([]);
  });

  it("巨大 KPI: 値が大数字枠（Value.Center）・見出しがラベル枠", () => {
    const deck = distillDeck(parseMd(SAMPLE), catalog);
    const at = boundByName(deck.slides[3], tpl, "KPI.1Value.Single");
    expect(at("Value.Center")).toBe("4.2 億円");
    expect(at("ValueLabel.Center")).toBe("年間コスト削減");
  });

  it("Ask 締め: 依頼 1 文が Ask 枠・選択肢と期限が Decision 枠", () => {
    const deck = distillDeck(parseMd(SAMPLE), catalog);
    const at = boundByName(deck.slides[9], tpl, "Closing.1Ask+1Decision");
    expect(at("SlideTitle.Header")).toBe("本日ご相談したいこと");
    expect(at("Ask.Center")).toBe("A 案（1 拠点への統合）の承認");
    expect(at("Decision.Bottom")).toBe("選択肢: A 案を承認／B 案で再検討\n期限: 12 月 15 日の経営会議");
  });
});

describe("全レイアウト見本 fixture（golden）", () => {
  it("見本デッキは書き出しで Executive の全レイアウトを 1 回ずつ使う（committed fixture を読む）", async () => {
    const used = await exportedLayouts(readFileSync(FIXTURE));
    expect([...used].sort()).toEqual([...EXECUTIVE_PRESET.layouts].sort());
  });

  it("committed fixture は再生成と中身が一致（出力の固定）", async () => {
    expect(await contentDigest(readFileSync(FIXTURE))).toBe(await contentDigest(await buildExecutiveFixture(tpl)));
  });

  it("generatePptx は決定論的（2 回生成して中身が一致）", async () => {
    const deck = distillDeck(parseMd(EXECUTIVE_FIXTURE_MD), catalog);
    expect(await contentDigest(await generatePptx(deck, tpl))).toBe(await contentDigest(await generatePptx(deck, tpl)));
  });
});
