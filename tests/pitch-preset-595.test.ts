/**
 * pitch-preset-595.test.ts — #595（#580 段 2-c）: セールスピッチ プリセット「Pitch」。
 *
 *  (a) プリセット表: 配色（canvas 白・background 濃色・emphasis＝accent）・書体（見出しと本文が同じゴシック）・
 *      密度（本文 18pt・左右 0.8in）・レイアウトの部分集合。生成テンプレは health ok・picture 枠あり・
 *      編集フィールドの写像は全レイアウトで全単射。
 *  (b) 出荷物とプリセット表の一致（R8）: public/templates/slide の TemplateOnly は writePresetTemplate(PITCH_PRESET)
 *      と part 単位で byte-identical。BUILTIN_MASTERS に登録され、既定（先頭）は技術報告のまま。
 *  (c) 受け入れ: samples/manuscript-05-sales-pitch.md（#580 目標デッキ A・14 枚）を Pitch で取り込むと
 *      14 枚のまま（自動分割 0）・get_deck_issues の消失系 0・ステートメント／引用／KPI.1／CTA が意図の
 *      レイアウトに入る。
 *  (d) golden: 全レイアウト見本 fixture は生成スクリプトの出力と part 単位で byte-identical。
 *  (e) 既存の不変: スタイル専用 LayoutDef（Media.1Body+1Image・Summary.3Block.Equal・Closing.1Ask+1Decision）は BUILTIN_LAYOUTS に入らない
 *      （既存 TemplateSpec の出力＝template-presets.test.ts の LEGACY_DIGEST が変わらない）。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createHash } from "crypto";
import JSZip from "jszip";
import { BUILTIN_LAYOUTS } from "../src/engine/template-layout-library";
import { PRESET_LAYOUTS } from "../src/engine/template-layout-library-style";
import { PITCH_PRESET, BASE_DENSITY, writePresetTemplate } from "../src/engine/template-presets";
import { loadTemplate, autoSelectLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog, assessTemplateHealth, placeholderRole } from "../src/engine/template-catalog";
import { bindContentByRole, buildFieldMap } from "../src/engine/placeholder-binding";
import { slideBindingPlan } from "../src/engine/group-binding";
import { imagePlaceholder } from "../src/engine/visual-placement";
import { parseMd } from "../src/engine/md-parser";
import { BUILTIN_MASTERS, BUILTIN_MASTER } from "../src/components/useMasterRegistry";
import * as S from "../src/mcp/session";
import { LOSS_RULES, measureTemplate, styleMetrics, evaluateTargets } from "../scripts/style-metrics";
import { PRESET_ARTIFACTS, buildTemplateOnly, buildShowcase } from "../scripts/gen-preset-templates";
import type { SlideIR, PlaceholderContent } from "../src/engine/slide-schema";

const ROOT = resolve(__dirname, "..");
const SHIPPED = resolve(ROOT, "public/templates/slide/セールスピッチ_Pitch_TemplateOnly.pptx");
const SHOWCASE = resolve(ROOT, "tests/fixtures/templates/セールスピッチ_Pitch_全レイアウト見本.pptx");
const DECK = resolve(ROOT, "samples/manuscript-05-sales-pitch.md");

const PITCH_LAYOUTS = [
  "Title.1Title.Single",
  "Statement.1Message.Single",
  "Content.1Body.Single",
  "Content.1Body.Single+1Callout",
  "Column.3Body.Equal",
  "Summary.3Block.Equal",
  "KPI.1Value.Single",
  "KPI.4Value.Grid",
  "Compare.2Option.Versus",
  "Process.4Step.Sequential",
  "Media.1Body+1Image",
  "Quote.1Message.Single+1Attribution",
  "Table.1Table.Single+1Source",
  "Closing.1CTA+1Contact",
];

/** 全パートの名前＋内容（zip のエントリ日時は含めない）。 */
async function parts(bytes: Uint8Array): Promise<Record<string, string>> {
  const z = await JSZip.loadAsync(bytes);
  const out: Record<string, string> = {};
  for (const n of Object.keys(z.files).sort()) {
    if (z.files[n].dir) continue;
    out[n] = createHash("sha256").update(await z.files[n].async("uint8array")).digest("hex");
  }
  return out;
}
const text = (c: PlaceholderContent | undefined) => c?.paragraphs.map((p) => p.segments.map((s) => s.text).join("")).join("\n");
const lum = (hex: string) => {
  const n = parseInt(hex, 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
};

let generated: Uint8Array;
let tpl: TemplateData;
beforeAll(async () => {
  generated = await writePresetTemplate(PITCH_PRESET);
  tpl = await loadTemplate(generated);
});

describe("(a) PITCH_PRESET — プリセット表", () => {
  it("配色: canvas 白・background は濃色・emphasis は accent と同じ・見出し文字は背景に対して明るい", () => {
    const p = PITCH_PRESET.palette;
    expect(p.canvas).toBe("FFFFFF");
    expect(lum(p.background)).toBeLessThan(80);
    expect(p.emphasis).toBe(p.accent);
    expect(lum(p.titleText) - lum(p.background)).toBeGreaterThan(150);
    expect(lum(p.canvas) - lum(p.bodyText)).toBeGreaterThan(150);
  });

  it("書体: 見出しも本文も同じゴシック系・密度: 本文 18pt・左右 0.8in", () => {
    expect(PITCH_PRESET.fonts.major).toBe(PITCH_PRESET.fonts.minor);
    expect(PITCH_PRESET.fonts.major).toMatch(/Gothic|ゴシック/);
    expect(PITCH_PRESET.density).toEqual({ ...BASE_DENSITY, bodyPt: 18 });
    expect(tpl.masterBodyStyle.fontSize).toBe(18);
  });

  it("レイアウトはピッチ用の部分集合（この順）で、生成テンプレは health ok", () => {
    expect(PITCH_PRESET.layouts).toEqual(PITCH_LAYOUTS);
    expect(tpl.layouts.map((l) => l.name)).toEqual(PITCH_LAYOUTS);
    expect(assessTemplateHealth(buildCatalog(tpl)).status).toBe("ok");
  });

  it("Media.1Body+1Image は本文 1 枠＋picture 枠 1 つ（画像が本文を隠さない並置）", () => {
    const media = tpl.layouts.find((l) => l.name === "Media.1Body+1Image")!;
    const roles = media.placeholders.map((p) => placeholderRole(p));
    expect(roles.filter((r) => r === "picture")).toHaveLength(1);
    expect(roles.filter((r) => r === "body")).toHaveLength(1);
    const body = media.placeholders.find((p) => placeholderRole(p) === "body")!.style;
    const pic = media.placeholders.find((p) => placeholderRole(p) === "picture")!.style;
    expect(body.x + body.w).toBeLessThanOrEqual(pic.x); // 左テキスト｜右画像（重ならない）
  });

  it("編集フィールドの写像は全レイアウトで全単射（単射・往復・単独入力）", () => {
    for (const layout of tpl.layouts) {
      const map = buildFieldMap({ layout: layout.name, placeholders: [] }, layout.placeholders);
      expect(new Set(map.map((m) => m.contentIdx)).size, layout.name).toBe(map.length);
      const probe: SlideIR = { layout: layout.name, placeholders: map.map((m, i) => ({ idx: m.contentIdx, paragraphs: [{ segments: [{ text: ` ${i}` }] }] })) };
      const bound = bindContentByRole(probe, layout.placeholders);
      map.forEach((m, i) => expect(text(bound.get(m.phIdx)), `${layout.name} ${m.phIdx}`).toBe(` ${i}`));
      for (const slot of map) {
        const solo: SlideIR = { layout: layout.name, placeholders: [{ idx: slot.contentIdx, paragraphs: [{ segments: [{ text: "S" }] }] }] };
        const b = bindContentByRole(solo, layout.placeholders);
        expect(text(b.get(slot.phIdx)), `${layout.name} ${slot.phIdx}`).toBe("S");
      }
    }
  });
});

describe("(b) 出荷物とプリセット表の一致（R8）", () => {
  it("出荷 TemplateOnly は writePresetTemplate(PITCH_PRESET) と part 単位で同一", async () => {
    expect(await parts(new Uint8Array(readFileSync(SHIPPED)))).toEqual(await parts(generated));
  });

  it("生成スクリプトの成果物表は Pitch の出荷先を持ち、その出力も同一（日付を固定した再生成で決定論的）", async () => {
    const a = PRESET_ARTIFACTS.find((x) => x.preset === PITCH_PRESET)!;
    expect(a.templateOnly).toBe("public/templates/slide/セールスピッチ_Pitch_TemplateOnly.pptx");
    const once = await buildTemplateOnly(a);
    expect(await parts(once)).toEqual(await parts(generated));
    expect(Buffer.from(await buildTemplateOnly(a)).equals(Buffer.from(once))).toBe(true);
  });

  it("BUILTIN_MASTERS に登録・既定（先頭）は技術報告のまま・CREDITS に記載", () => {
    expect(BUILTIN_MASTERS[0].id).toBe("builtin-gijutsu");
    expect(BUILTIN_MASTERS).toContainEqual({ id: "builtin-pitch", name: "セールスピッチ Pitch", url: "/templates/slide/セールスピッチ_Pitch_TemplateOnly.pptx" });
    expect(BUILTIN_MASTER.id).toBe("builtin-gijutsu");
    expect(readFileSync(resolve(ROOT, "public/templates/slide/CREDITS.md"), "utf8")).toContain("セールスピッチ_Pitch_TemplateOnly.pptx");
  });
});

describe("(c) 受け入れ: 提案書 14 枚を Pitch で取り込む", () => {
  const md = () => readFileSync(DECK, "utf8");

  it("14 枚のまま（自動分割 0）・get_deck_issues の消失系 0", async () => {
    const s = S.createSession(null);
    await S.newProject(s, generated, md());
    expect(s.deck!.slides).toHaveLength(14);
    const loss = S.getDiagnostics(s).issues.filter((d) => d.id && LOSS_RULES.includes(d.id));
    expect(loss).toEqual([]);
  });

  it("各スライドが意図のレイアウトに入る（ステートメント・引用・KPI.1・CTA・テキスト＋画像を含む）", async () => {
    const m = await measureTemplate(md(), "pitch", generated);
    expect(m.slides).toBe(14);
    expect(m.autoSplit).toBe(0);
    expect(m.perSlide.map((p) => p.layout)).toEqual([
      "Title.1Title.Single", // 表紙（Category / Date / Footer がすべて入る）
      "Statement.1Message.Single", // <!-- statement -->
      "Summary.3Block.Equal", // カード 3（＋結論帯）
      "KPI.1Value.Single", // ヒーロー数値
      "Media.1Body+1Image", // 左テキスト｜右画像
      "Summary.3Block.Equal", // カード 3
      "Content.1Body.Single", // 図
      "Compare.2Option.Versus", // 導入前後
      "KPI.4Value.Grid", // KPI 4
      "Quote.1Message.Single+1Attribution", // <!-- quote -->
      "Media.1Body+1Image", // 導入実績（ロゴ画像 1 枚）
      "Table.1Table.Single+1Source", // 料金表
      "Process.4Step.Sequential", // ロードマップ
      "Closing.1CTA+1Contact", // 次のステップ（CTA）
    ]);
  });

  it("中身が意図の枠に入る: 1 文＝大きな主枠・値＝大数字枠・引用と帰属は別枠・CTA は大きな行動枠・画像は picture 枠", async () => {
    const s = S.createSession(null);
    await S.newProject(s, generated, md());
    const catalog = buildCatalog(tpl);
    const slides = s.deck!.slides;
    const at = (i: number) => {
      const layout = tpl.layouts.find((l) => l.name === autoSelectLayout(slides[i], i, slides.length, catalog))!;
      const plan = slideBindingPlan(slides[i], layout);
      return (phName: string) => {
        const idx = layout.placeholders.find((p) => p.name === phName)!.idx;
        return text(plan.assignments.find((a) => a.placeholder.idx === idx)?.content.content);
      };
    };
    expect(at(1)("Message.Center")).toBe("必要な情報に、15 分かけていませんか。");
    expect(at(3)("Value.Center")).toBe("2 分");
    expect(at(3)("ValueLabel.Center")).toBe("検索時間");
    expect(at(9)("Quote.Center")).toBe("「どこにあるか分からなかった過去提案が、1 回の質問で出てくる。」");
    expect(at(9)("Attribution.Bottom")).toBe("— パイロット部門 マネージャー（仮）");
    expect(at(13)("CTA.Center")).toContain("パイロット部門の選定");
    expect(at(2)("CardHeading1")).toBe("散在"); // カード: 見出しは `:icon:` を除いた語（アイコンは図形で描く）
    expect(at(2)("CardBody3")).toBe("完全一致検索では言い回しの揺れで見つからない");
    expect(at(2)("Callout.Bottom")).toBe("情報はあるのに、組織として再利用できていない"); // Takeaway は結論帯へ
    expect(at(4)("Body.Left")).toContain("主要な社内ツールを横断して検索");
    for (const i of [4, 10]) {
      const layout = tpl.layouts.find((l) => l.name === "Media.1Body+1Image")!;
      const pic = layout.placeholders.find((p) => placeholderRole(p) === "picture")!;
      expect(slides[i].image, `slide ${i + 1}`).toBeTruthy();
      // 出力と同じ解決（visual-placement.imagePlaceholder）で picture 枠に入る＝本文枠を隠さない
      expect(imagePlaceholder(layout.placeholders, slides[i].image!.placeholderIdx)?.idx, `slide ${i + 1}`).toBe(pic.idx);
    }
  });

  it("書き出した PPTX に `:icon:` の記法が文字で残らない（カードのアイコンは描かれる）", async () => {
    const s = S.createSession(null);
    await S.newProject(s, generated, md());
    const z = await JSZip.loadAsync((await S.exportPptxBytes(s)).bytes);
    for (const n of [3, 6]) {
      const xml = await z.file(`ppt/slides/slide${n}.xml`)!.async("string");
      expect(xml, `slide ${n}`).not.toMatch(/:(storage|client|firewall|internet|monitor|vpn):/);
    }
  });

  it("セールスピッチの目標帯（1 枚 60 字以下・消失 0）に入る", async () => {
    const report = await styleMetrics("manuscript-05", md(), [{ name: "pitch", bytes: generated }]);
    expect(evaluateTargets(report, "pitch")).toEqual([{ template: "pitch", misses: [] }]);
  });
});

describe("(d) golden: 全レイアウト見本 fixture", () => {
  it("見本は全レイアウトを 1 枚ずつ（プリセットの順）使い、生成スクリプトの出力と part 単位で同一", async () => {
    const a = PRESET_ARTIFACTS.find((x) => x.preset === PITCH_PRESET)!;
    expect(a.showcase).toBe("tests/fixtures/templates/セールスピッチ_Pitch_全レイアウト見本.pptx");
    const fixture = new Uint8Array(readFileSync(SHOWCASE));
    expect(await parts(fixture)).toEqual(await parts(await buildShowcase(a)));
    const deck = parseMd(readFileSync(resolve(ROOT, a.showcaseMarkdown), "utf8"));
    const catalog = buildCatalog(tpl);
    expect(deck.slides.map((sl, i) => autoSelectLayout(sl, i, deck.slides.length, catalog))).toEqual(PITCH_LAYOUTS);
    const shown = await loadTemplate(fixture);
    expect(shown.layouts.map((l) => l.name)).toEqual(PITCH_LAYOUTS);
  });
});

describe("(e) 既存出力の不変", () => {
  it("スタイル専用 LayoutDef は BUILTIN_LAYOUTS に入らない（既存 TemplateSpec の出力は変わらない）", () => {
    const builtin = new Set(BUILTIN_LAYOUTS.map((d) => d.name));
    expect(PRESET_LAYOUTS.map((d) => d.name)).toEqual([
      "Media.1Body+1Image", "Summary.3Block.Equal", "Closing.1Ask+1Decision",
      // #598 Campaign
      "Image.FullBleed+1Caption", "Media.1Caption+1Image", "Gallery.2Image.Equal", "Gallery.4Image.Grid", "Section.1Title.ColorField", "Closing.1Notes.Bottom",
    ]);
    for (const d of PRESET_LAYOUTS) expect(builtin.has(d.name)).toBe(false);
  });
});
