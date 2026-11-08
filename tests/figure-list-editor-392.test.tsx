/**
 * figure-list-editor-392.test.tsx — #392 段 3: SlideEditor の field map が複数ビジュアル（figures）を扱う。
 *
 *  1. ビジュアルが置かれた枠（2 つ目以降も）には本文の入力欄を出さない。出すと、そこに打った文字は
 *     出力で図の下に隠れる（＝黙って消える）。判定は export と同じ visualOccupancy（R8）。
 *  2. ビジュアルが 2 つ以上のスライドにだけ「ビジュアル一覧」（順序・削除・2 つ目以降の図の編集）を出す。
 *     単一ビジュアルのスライドには何も足さない（常設の追加なし）。
 *  3. ja / en の文言キーがそろっている。
 * 操作（並べ替え・削除・編集）の中身は engine の slide-figure-edit（figures-edit-392.test.ts）で検査する。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { renderToStaticMarkup } from "react-dom/server";
import "../src/i18n";
import SlideEditor from "../src/components/SlideEditor";
import { loadTemplate, autoSelectLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";
import { visualOccupancy } from "../src/engine/visual-placement";
import { parseMd } from "../src/engine/md-parser";
import type { SlideIR } from "../src/engine/slide-schema";
import ja from "../src/i18n/locales/ja.json";
import en from "../src/i18n/locales/en.json";

let tpl: TemplateData;
beforeAll(async () => {
  tpl = await loadTemplate(readFileSync(resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx")));
});

const DIAG = (id: string) => "```diagram\ntype: flowchart\nnodes:\n  - id: " + id + "\n    label: " + id.toUpperCase() + "\n```";
const TABLE = "| k | v |\n|---|---|\n| a | 1 |";

function render(md: string) {
  const slide = parseMd(md).slides[0];
  const name = autoSelectLayout(slide, 1, 3, buildCatalog(tpl));
  const layout = tpl.layouts.find((l) => l.name === name)!;
  const html = renderToStaticMarkup(<SlideEditor slide={slide} layout={layout} onChange={() => {}} />);
  return { slide, layout, html };
}
/** The placeholder idxs that got a text field ("(idx N)" label). */
const fieldIdxs = (html: string) => [...html.matchAll(/\(idx (\d+)\)/g)].map((m) => m[1]);

describe("#392 段 3: no text field over ANY visual's box (R8: = visualOccupancy)", () => {
  const CASES: Record<string, string> = {
    "図×2": `# T\n\n${DIAG("a")}\n\n${DIAG("b")}`,
    "表＋図": `# T\n\n${TABLE}\n\n${DIAG("a")}`,
    "本文＋図×2": `# T\n\n- 説明\n\n${DIAG("a")}\n\n${DIAG("b")}`,
    "単一の図（不変）": `# T\n\n- 説明\n\n${DIAG("a")}`,
  };
  for (const [name, md] of Object.entries(CASES)) {
    it(name, () => {
      const { slide, layout, html } = render(md);
      const occupied = [...visualOccupancy(slide as SlideIR, layout.placeholders).keys()];
      expect(occupied.length).toBeGreaterThan(0);
      for (const idx of occupied) expect(fieldIdxs(html)).not.toContain(idx);
    });
  }
});

describe("#392 段 3: the visual list appears only on a multi-visual slide", () => {
  it("表＋図×2 → 3 行（出現順の種類名）・並べ替え／削除ボタン・2 つ目の図の YAML 欄", () => {
    const { html } = render(`# T\n\n${TABLE}\n\n${DIAG("a")}\n\n${DIAG("b")}`);
    expect(html).toContain(ja.slideEditor.figureList);
    const rows = [...html.matchAll(/data-figure-row="(\d+)" data-kind="(\w+)"/g)].map((m) => `${m[1]}:${m[2]}`);
    expect(rows).toEqual(["0:table", "1:diagram", "2:diagram"]);
    expect(html.split(`title="${ja.slideEditor.figureUp}"`).length - 1).toBe(3);
    expect(html.split(`title="${ja.slideEditor.figureDelete}"`).length - 1).toBe(3);
    expect(html).toContain("id: b"); // the 2nd diagram's source is editable in the list
  });
  it("単一ビジュアルのスライドには一覧を出さない（常設の追加なし）", () => {
    expect(render(`# T\n\n${DIAG("a")}`).html).not.toContain(ja.slideEditor.figureList);
    expect(render(`# T\n\n- 本文だけ`).html).not.toContain(ja.slideEditor.figureList);
  });
  it("ja / en の文言キーがそろっている", () => {
    for (const k of ["figureList", "figureUp", "figureDown", "figureDelete", "figureKind"] as const) {
      expect(ja.slideEditor).toHaveProperty(k);
      expect(en.slideEditor).toHaveProperty(k);
    }
  });
});
