/**
 * edit-path-baseline-392.test.ts — #392 段 0（既存動作の固定・テストのみ）: MCP／GUI の編集経路の現在の結果。
 *
 * edit-path-agreement.test.ts（#220: 2 つの扉が同じ編集を同じに適用する）の拡張。あちらは「両扉の一致」を、
 * こちらは**一致した結果そのもの**を、#392 段 3 が触る入口ごとに固定する（R1 の 400 行を守るため別ファイル）。
 *
 *   MCP: set_slide_markdown（S.applySlideMarkdown）・set_slide_diagram（S.setDiagram）
 *   GUI: applyFigureYaml・previewFigureEdit（src/engine/ai-apply.ts）
 *
 * テンプレは edit-path-agreement と同じ Midnight_Executive_30_TemplateOnly（commit 済み）。
 *
 * 更新手順: 挙動を意図して変えたときだけ `npx vitest run tests/edit-path-baseline-392.test.ts -u` で
 * tests/__snapshots__/edit-path-baseline-392.test.ts.snap を書き直し、差分を読んでから commit する。
 * **#392 段 1 以降で変わってよいのは複数ビジュアルのケースだけ**（名前に「[#392 で変わる予定]」と付けたもの）。
 * 単一ビジュアルのケースの差分は不変条件違反。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import * as S from "../src/mcp/session";
import { applyFigureYaml, previewFigureEdit } from "../src/engine/ai-apply";
import type { SlideIR } from "../src/engine/slide-schema";

let templateBytes: Buffer;
beforeAll(() => {
  templateBytes = readFileSync(resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx"));
});

const fence = (lang: string, body: string) => "```" + lang + "\n" + body + "\n```";
const DIAG_A = "type: flowchart\nnodes:\n  - id: a\n    label: A";
const DIAG_B = "type: flowchart\nnodes:\n  - id: b\n    label: B";
const TABLE = "| k | v |\n|---|---|\n| a | 1 |";
const NEW_YAML = "type: flowchart\nnodes:\n  - id: n\n    label: 新しい図";

/** Starting slide 1 (slide 0 is a cover) for each case, as Markdown. */
const START: Record<string, string> = {
  text: "# 中身\n\n- 一\n- 二",
  "diagram solo": "# 図\n\n" + fence("diagram", DIAG_A),
  "table solo": "# 表\n\n" + TABLE,
  "text + table": "# 本文と表\n\n- 説明\n\n" + TABLE,
  "col text | diagram": "# col\n\n<!-- col -->\n- 左\n\n<!-- col -->\n" + fence("diagram", DIAG_A),
  "[#392 で変わる予定] table + diagram (no col)": "# 表と図\n\n" + TABLE + "\n\n" + fence("diagram", DIAG_A),
};

async function session(slideMd: string) {
  const s = S.createSession(null);
  await S.newProject(s, templateBytes, "# 表紙\n\n---\n\n" + slideMd);
  return { s, old: s.deck!.slides[1] };
}
/** The visual fields of a slide (what #392 restructures) + its layout. */
const visuals = (sl: SlideIR) => ({
  layout: sl.layout,
  body: sl.placeholders.map((p) => p.idx),
  diagram: sl.diagram, table: sl.table, code: sl.code, image: sl.image, mermaidBlock: sl.mermaidBlock,
});

describe("#392 段 0: set_slide_markdown (MCP) — the applied slide and the tool result", () => {
  const EDITS: Record<string, string> = {
    "text → text + diagram": "# 中身\n\n- 一\n\n" + fence("diagram", DIAG_A),
    "text → table only": "# 中身\n\n" + TABLE,
    "[#392 で変わる予定] text → table + diagram (no col)": "# 中身\n\n" + TABLE + "\n\n" + fence("diagram", DIAG_A),
    "[#392 で変わる予定] text → two diagrams (last wins: the earlier one is dropped today)": "# 中身\n\n" + fence("diagram", DIAG_A) + "\n\n" + fence("diagram", DIAG_B),
    "[#392 で変わる予定] text → col table | diagram": "# 中身\n\n<!-- col -->\n" + TABLE + "\n\n<!-- col -->\n" + fence("diagram", DIAG_A),
  };
  for (const [name, edit] of Object.entries(EDITS)) {
    it(name, async () => {
      const { s } = await session(START.text);
      const r = S.applySlideMarkdown(s, 1, edit);
      expect({ result: r, slide: visuals(s.deck!.slides[1]) }).toMatchSnapshot();
    });
  }
  it("a text-only edit of a slide with a diagram carries the diagram (B3) — pinned value", async () => {
    const { s } = await session(START["col text | diagram"]);
    const r = S.applySlideMarkdown(s, 1, "# col 改\n\n- 左だけ");
    expect(r.ok).toBe(true);
    expect(visuals(s.deck!.slides[1])).toMatchSnapshot();
  });
});

describe("#392 段 0: set_slide_diagram (MCP) ≡ applyFigureYaml (GUI), and previewFigureEdit — current results", () => {
  for (const [name, md] of Object.entries(START)) {
    it(name, async () => {
      const { s, old } = await session(md);
      const gui = applyFigureYaml(old, NEW_YAML);
      const preview = previewFigureEdit(old, NEW_YAML);
      const r = S.setDiagram(s, 1, NEW_YAML, "yaml");
      expect(r.ok).toBe(true);
      expect(s.deck!.slides[1]).toEqual(gui); // the two doors still agree (#220)
      expect({ result: r, slide: visuals(s.deck!.slides[1]), preview }).toMatchSnapshot();
    });
  }
  it("[#392 で変わる予定] set_slide_diagram with placeholderIdx '2' on a table-solo slide", async () => {
    const { s } = await session(START["table solo"]);
    const r = S.setDiagram(s, 1, NEW_YAML, "yaml", "2");
    expect({ result: r, slide: visuals(s.deck!.slides[1]) }).toMatchSnapshot();
  });
  it("previewFigureEdit returns null for a non-figure edit (caller falls back to the Markdown diff)", async () => {
    const { old } = await session(START.text);
    expect(previewFigureEdit(old, "# 見出し\n\n- 箇条")).toBeNull();
  });
});
