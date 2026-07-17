/**
 * subtitle-role-recovery.test.ts — #125: ctrTitle（表紙）配下の idx=1 枠が body 型/型なしだと
 * role="body" になり、(1) subtitle content が未束縛（表紙のサブタイトルが出ない）、
 * (2) その枠が**箇条書きを吸う**（title 消失より悪い）。
 *
 * 根本原因は**左右の非対称**: content 側 slideIdxRole は「ctrTitle のレイアウトなら idx 1 = subtitle」と
 * 既に言っている（template-catalog.ts の `case "1": return hasCtrTitle ? "subtitle" : "body"`）のに、
 * layout 側 placeholderRole は type="body" / idx 1–9 を**絶対**で body と読む。ADR-0025 が title で
 * 直した gate 付き復元の、subtitle 版の穴。
 *
 * gate（ADR-0025 に倣う）:
 *  - レイアウトが ctrTitle を持ち、かつ subtitle ロールが1つも無い時だけ発火（本物の subtitle は奪わない）
 *  - 昇格先は PowerPoint の subtitle スロット＝ idx "1" の1枠のみ。meta ロール / chrome 帯は不可侵。
 *
 * idx 規約を rung にする理由（幾何ではなく）: 実コーパス 404 レイアウト中、gate を「ctrTitle ∧ subtitle
 * 無し」だけにすると CX_sample の Quote slide 3枚が発火する（ctrTitle=引用文、idx=11=帰属行 y=6.04 fs=28）。
 * この帰属行は「title の下・低背・小フォント」という subtitle 幾何と**区別できない**——が、ADR-0023 で
 * 「素の第三者マスターの body 型 idx-10+ は CONTENT」と決めた枠でもある。よって幾何 rung は採らず、
 * content 側と対称な idx-1 規約のみを rung にする。結果、全 404 レイアウトでロール変化 0＝ byte-identical。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync, existsSync } from "fs";
import { resolve, join } from "path";
import JSZip from "jszip";
import { placeholderRole, recoverLayoutSubtitle, slideIdxRole } from "../src/engine/template-catalog";
import { bindContentByRole, unboundContent } from "../src/engine/placeholder-binding";
import { loadTemplate } from "../src/engine/template-loader";
import type { PlaceholderInfo } from "../src/engine/template-loader";
import type { SlideIR } from "../src/engine/slide-schema";

const st = (o: Partial<{ x: number; y: number; w: number; h: number; fontSize: number }> = {}) =>
  ({ x: 0, y: 0, w: 0, h: 0, fontSize: 18, fontColor: "000000", fontName: "", bold: false, align: "l", bulletChar: "", ...o }) as never;
const ph = (o: Partial<PlaceholderInfo>): PlaceholderInfo =>
  ({ idx: "1", type: "", name: "", shapeXml: "", style: st(), metaIdxConvention: true, ...o }) as PlaceholderInfo;

// 表紙: ctrTitle(idx0) ＋ その下のサブタイトル枠(idx1)。実測どおり subtitle は y=4.05（幾何 rung の窓外）。
const ctrTitle = () => ph({ idx: "0", type: "ctrTitle", name: "Title 1", style: st({ x: 2, y: 2.6, w: 9.33, h: 1.4, fontSize: 32 }) });
const subBox = (o: Partial<PlaceholderInfo> = {}) =>
  ph({ idx: "1", name: "Text Placeholder 2", style: st({ x: 2, y: 4.05, w: 9.33, h: 0.6, fontSize: 14 }), ...o });

const content = (idx: string, text: string) => ({ idx, paragraphs: [{ segments: [{ text }] }] });
const cover = (phs: PlaceholderInfo[]): PlaceholderInfo[] => {
  recoverLayoutSubtitle(phs); // ローダーが load 時に1回呼ぶのと同じ（ロールは取込時に確定）
  return phs;
};

describe("#125 ctrTitle 配下の idx=1 枠は subtitle ロールへ復元される", () => {
  it("型なし idx=1 → subtitle（報告された 3 パターンのうち 1）", () => {
    const [, box] = cover([ctrTitle(), subBox()]);
    expect(placeholderRole(box)).toBe("subtitle");
  });

  it("body 型 idx=1 → subtitle（受け入れ基準そのもの・明示型でも復元する）", () => {
    const [, box] = cover([ctrTitle(), subBox({ type: "body" })]);
    expect(placeholderRole(box)).toBe("subtitle");
  });

  it("幾何が無くても（xfrm 継承 w=h=0）復元する＝ idx 規約 rung が効いている", () => {
    // 実マスターの大半は xfrm 継承で幾何ゼロ。幾何 rung ではここが救えない。
    const [, box] = cover([ctrTitle(), subBox({ type: "body", style: st() })]);
    expect(placeholderRole(box)).toBe("subtitle");
  });
});

describe("#125 gate: 本物の subtitle は絶対に奪わない / 表紙以外では発火しない", () => {
  it("subTitle 型が既にあるなら何も昇格しない（健全テンプレ byte-identical の要）", () => {
    const real = ph({ idx: "1", type: "subTitle", name: "Subtitle 2" });
    const other = ph({ idx: "2", type: "body", name: "本文", style: st({ x: 1, y: 4, w: 9, h: 2 }) });
    cover([ctrTitle(), real, other]);
    expect(placeholderRole(real)).toBe("subtitle");
    expect(placeholderRole(other)).toBe("body"); // 昇格先は1枠のみ＝他は不変
  });

  it("ctrTitle が無い（＝表紙でない）レイアウトの idx=1 は body のまま", () => {
    const body = subBox({ type: "body" });
    cover([ph({ idx: "0", type: "title", name: "Title" }), body]);
    expect(placeholderRole(body)).toBe("body"); // 本文スライドの idx1 を奪わない
  });

  it("meta ロール（date/footer/番号）は不可侵", () => {
    // idx=1 が dt 型のような病理でも、meta は昇格対象外（昇格可能＝ body/other のみ）。
    const dt = ph({ idx: "1", type: "dt", name: "Date" });
    cover([ctrTitle(), dt]);
    expect(placeholderRole(dt)).toBe("date");
  });

  it("chrome 帯は subtitle へ昇格しない（#96 の教訓を subtitle 経路でも守る）", () => {
    const band = ph({ idx: "1", type: "body", name: "帯", style: st({ x: 0.6, y: 7.0, w: 12.1, h: 0.3, fontSize: 9 }) });
    cover([ctrTitle(), band]);
    expect(placeholderRole(band)).not.toBe("subtitle");
  });

  it("冪等: 2回呼んでも結果は変わらない（gate が昇格後の subtitle を見て no-op）", () => {
    const phs = [ctrTitle(), subBox({ type: "body" })];
    recoverLayoutSubtitle(phs);
    recoverLayoutSubtitle(phs);
    expect(phs.filter((p) => placeholderRole(p) === "subtitle")).toHaveLength(1);
  });
});

describe("#125 束縛: subtitle が出る／箇条書きを吸わない", () => {
  // 症状 2 は「title 消失より悪い」——枠が body として content を受けてしまう。
  const layout = () => cover([ctrTitle(), subBox({ type: "body" }), ph({ idx: "2", type: "body", name: "本文", style: st({ x: 2, y: 5, w: 9.33, h: 1.5 }) })]);

  it("content 側 slideIdxRole と対称: 表紙の idx 1 は subtitle", () => {
    expect(slideIdxRole("1", true)).toBe("subtitle"); // 非対称こそが根本原因だった
  });

  it("subtitle content が idx=1 枠に束縛され、未束縛ゼロ", () => {
    const l = layout();
    const s = { layout: "表紙", placeholders: [content("0", "タイトル"), content("1", "サブタイトル")] } as unknown as SlideIR;
    expect(bindContentByRole(s, l).get("1")?.paragraphs[0].segments[0].text).toBe("サブタイトル");
    expect(unboundContent(s, l)).toEqual([]);
  });

  it("箇条書き（body content）は subtitle 枠を吸われず、実 body へ流れる", () => {
    const l = layout();
    const s = { layout: "表紙", placeholders: [content("1", "サブタイトル"), content("2", "箇条書き")] } as unknown as SlideIR;
    const bound = bindContentByRole(s, l);
    expect(bound.get("1")?.paragraphs[0].segments[0].text).toBe("サブタイトル");
    expect(bound.get("2")?.paragraphs[0].segments[0].text).toBe("箇条書き"); // 帰属先がズレない
  });

  it("反実仮想: 復元しなければ subtitle は未束縛で、枠は箇条書きを吸う（＝バグ再現）", () => {
    const l = [ctrTitle(), subBox({ type: "body" })]; // recoverLayoutSubtitle を通さない
    const s = { layout: "表紙", placeholders: [content("1", "サブタイトル"), content("2", "箇条書き")] } as unknown as SlideIR;
    expect(bindContentByRole(s, l).get("1")?.paragraphs[0].segments[0].text).toBe("箇条書き"); // 吸う
    expect(unboundContent(s, l).map((u) => u.role)).toContain("subtitle"); // subtitle は行き場なし
  });
});

// ── コーパス全体: 同梱テンプレ＋ fixture のロールが 1 件も変化しないこと ──
const DIRS = [
  resolve(__dirname, "../public/templates/slide"),
  resolve(__dirname, "fixtures/templates"),
  resolve(__dirname, "../test-data/master-intake"),
];

describe("#125 コーパス: ロール変化ゼロ（byte-identical の直接ゲート）", () => {
  let files: string[] = [];
  beforeAll(() => {
    files = DIRS.filter(existsSync).flatMap((d) =>
      readdirSync(d).filter((f) => /\.(pptx|potx)$/.test(f)).map((f) => join(d, f)),
    );
  });

  it("全テンプレの全レイアウトで、復元の再実行はロールを1件も動かさない", async () => {
    expect(files.length).toBeGreaterThan(10);
    let ctrTitleLayouts = 0;
    let promoted = 0;
    for (const f of files) {
      const tpl = await loadTemplate(readFileSync(f)); // loader は復元済みロールを stamp 済み
      for (const l of tpl.layouts) {
        const before = l.placeholders.map((p) => placeholderRole(p));
        recoverLayoutSubtitle(l.placeholders); // 冪等: 2回目は no-op
        expect(l.placeholders.map((p) => placeholderRole(p)), `${f} [${l.name}]`).toEqual(before);
        if (l.placeholders.some((p) => p.type.toLowerCase().includes("ctrtitle"))) {
          ctrTitleLayouts++;
          if (l.placeholders.some((p) => p.resolvedRole === "subtitle")) promoted++;
        }
      }
    }
    // 走査が空振りしていないことの sanity。floor は CI が保証する側＝**committed corpus** に較正する:
    // gitignore された IP テンプレ（CX_sample ＋ 会社 .potx 7本）はローカルにしか無いため、
    // ctrTitle レイアウト数は CI=30 / ローカル=40+ と環境で変わる（40 だとローカル緑・CI 赤になる）。
    expect(ctrTitleLayouts).toBeGreaterThan(25);
    expect(promoted).toBe(0); // 健全な表紙は subTitle 型を持つ＝発火 0＝既存出力は不変
  });

  it("実テンプレ（型を潰した表紙）: ローダー経由で復元が発火し、subtitle が束縛される", async () => {
    // sanitize-twin: 出荷テンプレ 配布資料 の 00_表紙 から subTitle 型だけを剥ぐ（＝報告された病理の実物）。
    // ここがローダー配線（load 時に1回・ロール確定）の唯一の証拠——ユニットは復元関数を直接呼ぶため。
    const src = readFileSync(resolve(__dirname, "../public/templates/slide/配布資料_公文書高密度_TemplateOnly.pptx"));
    const zip = await JSZip.loadAsync(src);
    for (const n of Object.keys(zip.files).filter((x) => /ppt\/slideLayouts\/.*\.xml$/.test(x))) {
      const xml = await zip.files[n].async("string");
      if (xml.includes('type="subTitle"')) zip.file(n, xml.replace(/type="subTitle"/g, 'type="body"'));
    }
    const tpl = await loadTemplate(await zip.generateAsync({ type: "uint8array" }));
    const cover = tpl.layouts.find((l) => l.name === "00_表紙")!;
    const box = cover.placeholders.find((p) => p.idx === "1")!;
    expect(box.type).toBe("body"); // 型は潰れている
    expect(placeholderRole(box)).toBe("subtitle"); // それでもロールは復元される

    const s = {
      layout: "00_表紙",
      placeholders: [content("0", "タイトル"), content("1", "サブタイトル"), content("14", "2026-07-17 / 企画部")],
    } as unknown as SlideIR;
    const bound = bindContentByRole(s, cover.placeholders);
    expect(bound.get("1")?.paragraphs[0].segments[0].text).toBe("サブタイトル"); // 表紙にサブタイトルが出る
    expect(unboundContent(s, cover.placeholders)).toEqual([]); // 未束縛 0
  });

  it("CX_sample の Quote slide（ctrTitle ＋ 帰属行 idx=11）は body のまま＝ ADR-0023 を壊さない", async () => {
    const cx = resolve(__dirname, "fixtures/templates/CX_sample_MSGothic.pptx");
    if (!existsSync(cx)) return;
    const tpl = await loadTemplate(readFileSync(cx));
    const quote = tpl.layouts.find((l) => l.name.startsWith("Quote slide"));
    expect(quote, "CX fixture に Quote slide が必要").toBeTruthy();
    const attribution = quote!.placeholders.find((p) => p.idx === "11")!;
    expect(placeholderRole(attribution)).toBe("body"); // 幾何 rung を採ると subtitle に化ける枠
  });
});
