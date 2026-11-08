/**
 * figures-edit-392.test.ts — #392 段 3: 複数ビジュアルの「書き込み」を 1 か所に（slide-figure-edit.ts）。
 *
 * 段 1 で決めた読み取りの正（slide-figures.slideFigures）: 種類ごとの 1 つ目は**単数フィールドが正**、
 * `figures` は順序と 2 つ目以降を持つ（2 つ以上のときだけ付く）。段 3 はその逆向き＝書き込みを
 * `withFigures(slide, list)` 1 本にする（R8: 読みと書きが互いの逆写像であることをここで固定する）。
 * GUI（SlideEditor の一覧）・MCP（set_slide_diagram の figure）・編集の引き継ぎ（carryOmittedBlocks）は
 * すべてこの 1 本を通る。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parseMd } from "../src/engine/md-parser";
import { serializeMd } from "../src/engine/md-serializer";
import { slideFigures } from "../src/engine/slide-figures";
import { withFigures, moveFigure, removeFigure, updateFigure, diagramFigureNumbers } from "../src/engine/slide-figure-edit";
import type { SlideIR, FigureBlock } from "../src/engine/slide-schema";

const DIAG = (id: string) => "```diagram\nnodes:\n  - id: " + id + "\n    label: " + id.toUpperCase() + "\n```";
const TABLE = (v: string) => `| k | v |\n| --- | --- |\n| a | ${v} |`;
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const one = (md: string): SlideIR => parseMd(md).slides[0];
const kinds = (s: SlideIR) => slideFigures(s).map((f) => f.kind);
const yamlOf = (f: FigureBlock) => (f.kind === "diagram" ? f.yaml : "");

const corpus = (): SlideIR[] =>
  ["tests/fixtures/slideir-baseline/visuals.md", "samples/README.md"].flatMap((p) => parseMd(readFileSync(resolve(__dirname, "..", p), "utf8")).slides);

describe("#392 段 3: withFigures は slideFigures の逆（R8・正規化の 1 か所）", () => {
  it("コーパス全スライド: withFigures(s, slideFigures(s)) は s と同じ（単一ビジュアルは figures を足さない）", () => {
    for (const s of corpus()) expect(withFigures(s, slideFigures(s))).toEqual(s);
  });

  it("任意の並びを書いて読むと同じ並び（slideFigures ∘ withFigures = id）", () => {
    const s = one(`# T\n\n${TABLE("1")}\n\n${DIAG("a")}\n\n${DIAG("b")}`);
    const rev = [...slideFigures(s)].reverse();
    expect(slideFigures(withFigures(s, rev))).toEqual(rev);
  });

  it("figures[0] の写しが古い（単数フィールドだけ編集された）スライドも、書き直すと単数＝一覧の 1 つ目にそろう", () => {
    const s = one(`# T\n\n${DIAG("a")}\n\n${DIAG("b")}`);
    const edited: SlideIR = { ...s, diagram: { ...s.diagram!, yaml: "nodes:\n  - id: z\n    label: Z" } }; // 単数だけ書き換え（旧 GUI の経路）
    expect(yamlOf(edited.figures![0])).toContain("id: a"); // 写しは古い
    const norm = withFigures(edited, slideFigures(edited));
    expect(yamlOf(norm.figures![0])).toContain("id: z");
    expect(norm.diagram!.yaml).toContain("id: z");
    expect(slideFigures(norm)).toEqual(slideFigures(edited)); // 読み取り結果は変わらない
  });

  it("1 つに減ると figures は消え、単数フィールドだけになる（単一ビジュアルの形）", () => {
    const s = one(`# T\n\n${TABLE("1")}\n\n${DIAG("a")}`);
    const r = removeFigure(s, 0);
    expect(r.figures).toBeUndefined();
    expect(r.table).toBeUndefined();
    expect(r.diagram?.yaml).toContain("id: a");
  });

  it("背面画像は一覧に入らず、書き込みでも保持される", () => {
    const s = one(`# T\n\n![bg](${PNG}){behind=1}\n\n${DIAG("a")}\n\n${DIAG("b")}`);
    expect(s.image?.behind).toBe(true);
    const r = removeFigure(s, 1);
    expect(r.image).toEqual(s.image);
    expect(kinds(r)).toEqual(["diagram"]);
  });
});

describe("#392 段 3: 個々のビジュアルの編集・削除・順序（GUI の一覧が使う）", () => {
  it("moveFigure: 表＋図 → 図＋表。md も入れ替わり、round-trip で安定", () => {
    const s = one(`# T\n\n${TABLE("1")}\n\n${DIAG("a")}`);
    const r = moveFigure(s, 1, 0);
    expect(kinds(r)).toEqual(["diagram", "table"]);
    const md = serializeMd({ slides: [r] });
    expect(md.indexOf("```diagram")).toBeLessThan(md.indexOf("| k | v |"));
    expect(serializeMd(parseMd(md))).toBe(md);
  });

  it("moveFigure: 同種 2 つの入れ替えで単数フィールド（1 つ目）も入れ替わる", () => {
    const s = one(`# T\n\n${DIAG("a")}\n\n${DIAG("b")}`);
    const r = moveFigure(s, 0, 1);
    expect(r.diagram!.yaml).toContain("id: b");
    expect(slideFigures(r).map(yamlOf).map((y) => y.match(/id: (\w)/)![1])).toEqual(["b", "a"]);
  });

  it("removeFigure: 2 つ目の図だけを消す（1 つ目は残る）", () => {
    const s = one(`# T\n\n${DIAG("a")}\n\n${DIAG("b")}\n\n${TABLE("1")}`);
    const r = removeFigure(s, 1);
    expect(kinds(r)).toEqual(["diagram", "table"]);
    expect(r.diagram!.yaml).toContain("id: a");
    expect(JSON.stringify(r)).not.toContain("id: b");
  });

  it("removeFigure: 1 つ目の図を消すと 2 つ目が単数フィールドに繰り上がる（取り残されない）", () => {
    const s = one(`# T\n\n${DIAG("a")}\n\n${DIAG("b")}\n\n${TABLE("1")}`);
    const r = removeFigure(s, 0);
    expect(r.diagram!.yaml).toContain("id: b");
    expect(kinds(r)).toEqual(["diagram", "table"]);
  });

  it("updateFigure: 2 つ目の図の YAML だけを書き換える", () => {
    const s = one(`# T\n\n${DIAG("a")}\n\n${DIAG("b")}`);
    const f = slideFigures(s)[1];
    const r = updateFigure(s, 1, { ...f, yaml: "nodes:\n  - id: c\n    label: C" } as FigureBlock);
    expect(slideFigures(r).map(yamlOf).map((y) => y.match(/id: (\w)/)![1])).toEqual(["a", "c"]);
    expect(r.diagram!.yaml).toContain("id: a");
  });

  it("範囲外の位置は例外（黙って何もしない、をしない）", () => {
    const s = one(`# T\n\n${DIAG("a")}\n\n${DIAG("b")}`);
    expect(() => removeFigure(s, 2)).toThrow();
    expect(() => moveFigure(s, 0, 2)).toThrow();
  });

  it("diagramFigureNumbers: 図（diagram / mermaid）が全ビジュアルの何番目にあるか（1 始まり）", () => {
    const s = one(`# T\n\n${TABLE("1")}\n\n${DIAG("a")}\n\n\`\`\`mermaid\ngantt\n  title x\n\`\`\``);
    expect(kinds(s)).toEqual(["table", "diagram", "mermaid"]);
    expect(diagramFigureNumbers(s)).toEqual([2, 3]);
  });
});
