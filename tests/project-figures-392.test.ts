/**
 * project-figures-392.test.ts — #392 段 3: `.scft` と複数ビジュアル（figures）。
 *
 * 決定（PR 本文に記録）:
 *  - **正は単数フィールド**（種類ごとの 1 つ目）。`figures` は順序と 2 つ目以降を持ち、その 1 つ目の写しは
 *    読まれない（slide-figures.slideFigures）。書き込みは slide-figure-edit.withFigures の 1 本。
 *  - よって**旧形式（単数フィールドだけ）の `.scft` はそのまま正しい形**で、migrate の段（PROJECT_VERSION の
 *    引き上げ）は要らない。段 0 の project-scft-baseline-392（読み戻しの DeckIR が保存時と同じ）は不変。
 *  - 開くときに書き直し（正規化）はしない（すると旧 .scft の DeckIR が変わり、段 0 の固定に反する）。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { openProject, bundleProject, migrateProjectDeck, PROJECT_VERSION } from "../src/engine/project-io";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import { parseMd } from "../src/engine/md-parser";
import { slideFigures } from "../src/engine/slide-figures";
import { withFigures } from "../src/engine/slide-figure-edit";
import type { DeckIR } from "../src/engine/slide-schema";

const ROOT = resolve(__dirname, "..");
const FIXTURE = resolve(ROOT, "tests/fixtures/projects/visuals-v1.scft");
const DIAG = (id: string) => "```diagram\ntype: flowchart\nnodes:\n  - id: " + id + "\n    label: " + id + "\n```";
const META = { templateName: "t", savedAt: "2026-11-08T00:00:00.000Z" };

let tpl: TemplateData;
beforeAll(async () => {
  tpl = await loadTemplate(readFileSync(resolve(ROOT, "public/templates/slide/技術報告_スタンダード水色_TemplateOnly.pptx")));
});

describe("#392 段 3: the old (singular-only) form needs no migration", () => {
  it("v1 は今も現行版で、migrateProjectDeck は deck をそのまま返す", async () => {
    expect(PROJECT_VERSION).toBe(1);
    const raw = JSON.parse(await (await JSZip.loadAsync(readFileSync(FIXTURE))).file("deck.json")!.async("string"));
    expect(migrateProjectDeck(raw, 1)).toBe(raw);
  });
  it("旧 .scft の各スライドは、読みと書きの 1 本（slideFigures / withFigures）で同じビジュアル一覧のまま", async () => {
    const { deck } = await openProject(readFileSync(FIXTURE));
    for (const s of deck.slides) {
      expect(s.figures).toBeUndefined(); // 旧形式
      expect(slideFigures(withFigures(s, slideFigures(s)))).toEqual(slideFigures(s));
    }
  });
});

describe("#392 段 3: the new form round-trips through .scft", () => {
  it("図×2 のデッキ: save → open で DeckIR が同じ（figures も保持）", async () => {
    const deck = parseMd(`# 表紙\n\n---\n\n# 図 2 つ\n\n${DIAG("one")}\n\n${DIAG("two")}`);
    expect(deck.slides[1].figures).toHaveLength(2);
    const { deck: opened } = await openProject(await bundleProject(deck, tpl, META));
    expect(opened).toEqual(deck);
  });
  it("figures[0] が古い写しのファイルも、単数フィールドを正として読む（開いても書き換えない）", async () => {
    const deck = parseMd(`# 表紙\n\n---\n\n# 図 2 つ\n\n${DIAG("one")}\n\n${DIAG("two")}`);
    const stale: DeckIR = { ...deck, slides: deck.slides.map((s, i) => (i === 1 ? { ...s, diagram: { ...s.diagram!, yaml: DIAG("new").slice(11, -4) } } : s)) };
    const { deck: opened } = await openProject(await bundleProject(stale, tpl, META));
    expect(opened).toEqual(stale);
    const ids = slideFigures(opened.slides[1]).map((f) => (f.kind === "diagram" ? f.yaml.match(/id: (\w+)/)![1] : ""));
    expect(ids).toEqual(["new", "two"]);
  });
});
