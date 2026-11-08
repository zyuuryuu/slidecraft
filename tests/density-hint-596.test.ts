/**
 * density-hint-596.test.ts — #596（#580 段 2-d）: 文字量を絞る規則（密度の目標帯）。
 *
 * 規則はテンプレのメタ（StylePreset.density → 生成テンプレの docProps/custom.xml）から読む 1 経路（R8）:
 *   writePresetTemplate が density の目標（maxBodyLines / maxLineChars）を custom.xml に書き、loadTemplate が
 *   TemplateData.styleDensity に読み戻し、get_deck_issues（S.getDiagnostics）が densityIssues で info を足す。
 *   デッキ側に第 2 の軸は持たない。目標の無いテンプレ（既存テンプレすべて）では 1 件も出ない。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { densityIssues } from "../src/engine/density-hint";
import { REVIEW_RULES } from "../src/engine/review-rules";
import { withStyleDensityMeta, readStyleDensity, STYLE_DENSITY_PROP } from "../src/engine/style-meta";
import { REPORT_PRESET, BASE_DENSITY, writePresetTemplate, type StylePreset, type StyleDensity } from "../src/engine/template-presets";
import { writeTemplate, MIDNIGHT_PALETTE } from "../src/engine/template-writer";
import { adjustTemplate } from "../src/engine/template-adjust";
import { loadTemplate } from "../src/engine/template-loader";
import { parseMd } from "../src/engine/md-parser";
import * as S from "../src/mcp/session";
import { setReviewRules } from "../src/mcp/review-rules";

const TARGETS: StyleDensity = { ...BASE_DENSITY, maxBodyLines: 3, maxLineChars: 45 };
const COVER = "# 表紙\n\nサブタイトル\n\n---\n\n";
const bullets = (n: number) => Array.from({ length: n }, (_, i) => `- 要点 ${i + 1}`).join("\n");
const SHIPPED = (f: string) => readFileSync(resolve(__dirname, "../public/templates/slide", f));
const MIDNIGHT = readFileSync(resolve(__dirname, "../samples/templates/Midnight_Executive_30_TemplateOnly.pptx"));

describe("densityIssues — 純関数（本文の行数・1 行の字数）", () => {
  it("目標が無ければ（既存テンプレ）何も出さない", () => {
    const deck = parseMd(COVER + "# 多い\n\n" + bullets(8));
    expect(densityIssues(deck, undefined)).toEqual([]);
    expect(densityIssues(deck, BASE_DENSITY)).toEqual([]); // bodyPt/marginIn だけでは目標帯にならない
  });

  it("本文 4 行のスライドに info が 1 件（3 行なら 0 件）・id は REVIEW_RULES に登録済み", () => {
    const four = densityIssues(parseMd(COVER + "# 補足\n\n" + bullets(4)), TARGETS);
    expect(four).toHaveLength(1);
    expect(four[0]).toMatchObject({ slideIndex: 1, title: "補足", level: "info", id: "density-target" });
    expect(four[0].message).toContain("4 行");
    expect(four[0].message).toContain("3 行");
    expect(REVIEW_RULES).toContainEqual({ id: "density-target", level: "info" });
    expect(densityIssues(parseMd(COVER + "# 補足\n\n" + bullets(3)), TARGETS)).toEqual([]);
  });

  it("1 行が目標字数（45 字）を超えると info（45 字ちょうどは出ない）", () => {
    const at = (n: number) => densityIssues(parseMd(COVER + "# 長い\n\n- " + "あ".repeat(n)), TARGETS);
    expect(at(45)).toEqual([]);
    const over = at(46);
    expect(over).toHaveLength(1);
    expect(over[0].message).toContain("46 字");
  });

  it("グループの見出し（### 行）は本文の行に数えない・枠ごとに数える", () => {
    const cards = COVER + "# 3 点\n\n" + [1, 2, 3].map((i) => `<!-- card -->\n### 見出し ${i}\n${bullets(3)}`).join("\n\n");
    expect(densityIssues(parseMd(cards), TARGETS)).toEqual([]);
    const heavy = COVER + "# 3 点\n\n<!-- card -->\n### A\n" + bullets(4) + "\n\n<!-- card -->\n### B\n" + bullets(5);
    expect(densityIssues(parseMd(heavy), TARGETS)).toHaveLength(1); // 1 枚に 1 件（枠が 2 つ超えても）
  });

  it("タイトル・サブタイトル・Takeaway などの本文以外は数えない", () => {
    const md = COVER + "# 要約\n\n## 補足の見出し\n\n" + bullets(3) + "\n\nTakeaway: " + "結".repeat(60);
    expect(densityIssues(parseMd(md), TARGETS)).toEqual([]);
  });
});

describe("style-meta — 目標帯をテンプレのメタに書いて読み戻す（1 経路）", () => {
  it("目標の無いプリセットは custom.xml を書かない（REPORT_PRESET の出力は従来どおり）", async () => {
    const z = await JSZip.loadAsync(await writePresetTemplate(REPORT_PRESET));
    expect(z.file("docProps/custom.xml")).toBeNull();
    expect(await readStyleDensity(z)).toBeUndefined();
  });

  it("目標付きプリセットは custom.xml（Content_Types と _rels も整合）に density を書き、loader が読み戻す", async () => {
    const preset: StylePreset = { ...REPORT_PRESET, name: "Dense Target", density: TARGETS };
    const bytes = await writePresetTemplate(preset);
    const z = await JSZip.loadAsync(bytes);
    const custom = await z.file("docProps/custom.xml")!.async("string");
    expect(custom).toContain(`name="${STYLE_DENSITY_PROP}"`);
    expect(await z.file("[Content_Types].xml")!.async("string")).toContain(`PartName="/docProps/custom.xml"`);
    expect(await z.file("_rels/.rels")!.async("string")).toContain(`Target="docProps/custom.xml"`);
    expect((await loadTemplate(bytes)).styleDensity).toEqual(TARGETS);
  });

  it("withStyleDensityMeta は冪等（2 回掛けても custom.xml・rel・Override は 1 つ）", async () => {
    const base = await writeTemplate({ name: "x", fonts: { major: "Arial", minor: "Arial" }, palette: { ...MIDNIGHT_PALETTE } });
    const twice = await withStyleDensityMeta(await withStyleDensityMeta(base, TARGETS), TARGETS);
    const z = await JSZip.loadAsync(twice);
    const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
    expect(count(await z.file("[Content_Types].xml")!.async("string"), /docProps\/custom\.xml/g)).toBe(1);
    expect(count(await z.file("_rels/.rels")!.async("string"), /docProps\/custom\.xml/g)).toBe(1);
    expect(await readStyleDensity(z)).toEqual(TARGETS);
  });

  it("#570 の adjustTemplate（本文倍率）を掛けた派生でもメタは残る（文字を大きく・量を減らす調整と両立）", async () => {
    const bytes = await writePresetTemplate({ ...REPORT_PRESET, name: "Dense Target", density: TARGETS });
    const bigger = await adjustTemplate(bytes, { scale: { body: 1.2 } });
    expect((await loadTemplate(bigger)).styleDensity).toEqual(TARGETS);
  });

  it("壊れた／無関係な custom.xml は無視（undefined）", async () => {
    const z = new JSZip();
    z.file("docProps/custom.xml", `<Properties><property name="${STYLE_DENSITY_PROP}"><vt:lpwstr>{oops</vt:lpwstr></property></Properties>`);
    expect(await readStyleDensity(z)).toBeUndefined();
    const z2 = new JSZip();
    z2.file("docProps/custom.xml", `<Properties><property name="Other"><vt:lpwstr>{"maxBodyLines":3}</vt:lpwstr></property></Properties>`);
    expect(await readStyleDensity(z2)).toBeUndefined();
  });
});

describe("get_deck_issues（S.getDiagnostics）への配線", () => {
  const md = COVER + "# 補足\n\n" + bullets(4);

  it("目標付きテンプレでは density-target が 1 件・set_review_rules で off にできる", async () => {
    const s = S.createSession(null);
    await S.newProject(s, await writePresetTemplate({ ...REPORT_PRESET, name: "Dense Target", density: TARGETS }), md);
    expect(S.getDiagnostics(s).issues.filter((i) => i.id === "density-target")).toHaveLength(1);
    setReviewRules(s, { "density-target": "off" });
    expect(S.getDiagnostics(s).issues.filter((i) => i.id === "density-target")).toEqual([]);
  });

  it("既定テンプレ（出荷 3 本）と Midnight では 0 件", async () => {
    for (const bytes of [
      SHIPPED("技術報告_スタンダード水色_TemplateOnly.pptx"),
      SHIPPED("配布資料_公文書高密度_TemplateOnly.pptx"),
      SHIPPED("ビジュアルデッキ_マガジン_TemplateOnly.pptx"),
      MIDNIGHT,
    ]) {
      const s = S.createSession(null);
      await S.newProject(s, bytes, md);
      expect(S.getDiagnostics(s).issues.filter((i) => i.id === "density-target")).toEqual([]);
    }
  });
});
