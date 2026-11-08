/**
 * slide-figures-392.test.ts — #392 段 1: SlideIR に `figures?: FigureBlock[]` を足し、1 スライドの複数ビジュアル
 * （同種 2 つ目以降・異種の組）を parser が保持し、serializer が出現順で書き戻す。
 *
 * `figures` の意味（slide-figures.ts）: 本文ビジュアル（diagram / mermaid / table / code / 背面でない image）が
 * **2 つ以上**のスライドにだけ付き、**全件を出現順**で持つ。単数フィールド（diagram 等）は種類ごとの
 * **1 つ目**を引き続き持つ（読み込み互換）。ビジュアル一覧を読む経路は `slideFigures(slide)` 1 本（R8）。
 * 配置・描画（2 つ目以降を別の枠に描く）は段 2 — それまでは描かれないことを `figure-dropped` で告知する。
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { parseMd, parseMdReport } from "../src/engine/md-parser";
import { serializeMd } from "../src/engine/md-serializer";
import { slideFigures, undrawnFigures } from "../src/engine/slide-figures";
import { diagnoseDeck } from "../src/engine/deck-diagnostics";
import type { SlideIR } from "../src/engine/slide-schema";

const DIAG = (id: string) => "```diagram\nnodes:\n  - id: " + id + "\n    label: " + id.toUpperCase() + "\n```";
const TABLE = (v: string) => `| k | v |\n| --- | --- |\n| a | ${v} |`;
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** f = serialize∘parse. The source md must already be in the serializer's normal form, so f(md) === md. */
const roundTrip = (md: string) => serializeMd(parseMd(md));

describe("#392 段 1 (a): 同種 2 つ目以降が figures[] に残る", () => {
  it("```diagram ×2 → figures に 2 件（出現順）・単数 diagram は 1 つ目・parse の figure-dropped は出ない", () => {
    const { deck, notices } = parseMdReport(`# T\n\n${DIAG("one")}\n\n${DIAG("two")}`);
    const s = deck.slides[0];
    expect(s.figures?.map((f) => f.kind)).toEqual(["diagram", "diagram"]);
    expect(s.figures?.[0]).toMatchObject({ kind: "diagram", placeholderIdx: "1" });
    expect((s.figures?.[0] as { yaml: string }).yaml).toContain("id: one");
    expect((s.figures?.[1] as { yaml: string }).yaml).toContain("id: two");
    expect(s.diagram?.yaml).toContain("id: one");
    expect(notices).toEqual([]);
  });

  it("```diagram の後の flowchart ```mermaid（diagram に昇格）も 2 件目として残る", () => {
    const s = parseMd(`# T\n\n${DIAG("one")}\n\n\`\`\`mermaid\nflowchart LR\n  m1 --> m2\n\`\`\``).slides[0];
    expect(s.figures?.map((f) => f.kind)).toEqual(["diagram", "diagram"]);
  });

  it("非 flowchart の ```mermaid ×2 → figures に mermaid 2 件", () => {
    const m = (x: string) => "```mermaid\ngantt\n  title " + x + "\n```"; // gantt: no DiagramSpec form → stays mermaid
    const s = parseMd(`# T\n\n${m("hi")}\n\n${m("yo")}`).slides[0];
    expect(s.figures?.map((f) => f.kind)).toEqual(["mermaid", "mermaid"]);
    expect(s.mermaidBlock?.mermaid).toContain("hi");
  });

  it("コード ×2（従来は後勝ちで告知なしに消えていた）→ 2 件とも残る", () => {
    const s = parseMd("# T\n\n```ts\nconst a = 1;\n```\n\n```py\nb = 2\n```").slides[0];
    expect(s.figures?.map((f) => f.kind)).toEqual(["code", "code"]);
    expect(s.code).toMatchObject({ content: "const a = 1;", lang: "ts" });
  });

  it("表 ×2（従来は 2 つ目と前後の本文が table-dropped で消えていた）→ 2 件とも残り、本文も残る", () => {
    const { deck, notices } = parseMdReport(`# T\n\n${TABLE("1")}\n\n間の本文\n\n${TABLE("2")}`);
    const s = deck.slides[0];
    expect(s.figures?.map((f) => f.kind)).toEqual(["table", "table"]);
    expect(s.table?.rows).toEqual([["k", "v"], ["a", "1"]]);
    expect(s.placeholders.find((p) => p.idx === "1")?.paragraphs[0].segments[0].text).toBe("間の本文");
    expect(notices).toEqual([]);
  });

  it("画像 ×2（背面でない）→ 2 件とも figures に残る（2 枚目が本文テキストに落ちない）", () => {
    const s = parseMd(`# T\n\n![a](${PNG})\n\n![b](${PNG})`).slides[0];
    expect(s.figures?.map((f) => f.kind)).toEqual(["image", "image"]);
    expect(s.image?.alt).toBe("a");
    expect(s.placeholders.map((p) => p.idx)).toEqual(["15"]);
  });

  it("<!-- col --> 図｜図 → figures に列ごとの placeholderIdx で 2 件・告知なし", () => {
    const { deck, notices } = parseMdReport(`# T\n\n<!-- col -->\n${DIAG("one")}\n\n<!-- col -->\n${DIAG("two")}`);
    const s = deck.slides[0];
    expect(s.figures?.map((f) => [f.kind, f.placeholderIdx])).toEqual([["diagram", "1"], ["diagram", "2"]]);
    expect(s.diagram?.placeholderIdx).toBe("1");
    expect(notices).toEqual([]);
  });

  it("<!-- col --> 表｜表（従来は #412 table-dropped）→ 2 件とも残る", () => {
    const { deck, notices } = parseMdReport(`# T\n\n<!-- col -->\n${TABLE("1")}\n\n<!-- col -->\n${TABLE("2")}`);
    expect(deck.slides[0].figures?.map((f) => [f.kind, f.placeholderIdx])).toEqual([["table", "1"], ["table", "2"]]);
    expect(notices).toEqual([]);
  });
});

describe("#392 段 1 (b): 異種の組も出現順で両方保持", () => {
  it("表→図 の順 → figures [table, diagram]", () => {
    const s = parseMd(`# T\n\n${TABLE("1")}\n\n${DIAG("d")}`).slides[0];
    expect(s.figures?.map((f) => f.kind)).toEqual(["table", "diagram"]);
    expect(s.table).toBeDefined();
    expect(s.diagram).toBeDefined();
  });

  it("図→表 の順 → figures [diagram, table]（順序はスライド上の出現位置で決まる）", () => {
    const s = parseMd(`# T\n\n${DIAG("d")}\n\n${TABLE("1")}`).slides[0];
    expect(s.figures?.map((f) => f.kind)).toEqual(["diagram", "table"]);
  });

  it("本文がある時は全ビジュアルが #390 と同じく ordinal 2 に寄る（単数フィールドと figures で同じ値）", () => {
    const s = parseMd(`# T\n\n- 本文\n\n${TABLE("1")}\n\n${DIAG("d")}`).slides[0];
    expect(s.figures?.map((f) => f.placeholderIdx)).toEqual(["2", "2"]);
    expect(s.table?.placeholderIdx).toBe("2");
    expect(s.diagram?.placeholderIdx).toBe("2");
  });
});

describe("#392 段 1 (c): 複数ビジュアルの round-trip が不動点（serializer は出現順で書き戻す）", () => {
  const cases: Record<string, string> = {
    "図×2": `# T\n\n${DIAG("one")}\n\n${DIAG("two")}\n`,
    "表→図": `# T\n\n${TABLE("1")}\n\n${DIAG("d")}\n`,
    "図→表": `# T\n\n${DIAG("d")}\n\n${TABLE("1")}\n`,
    "本文＋表＋図": `# T\n\n- 本文\n\n${TABLE("1")}\n\n${DIAG("d")}\n`,
    "コード×2": "# T\n\n```ts\nconst a = 1;\n```\n\n```py\nb = 2\n```\n",
    "画像×2": `# T\n\n![a](${PNG})\n\n![b](${PNG})\n`,
    "表×2": `# T\n\n${TABLE("1")}\n\n${TABLE("2")}\n`,
    "col 図｜図": `# T\n\n<!-- col -->\n${DIAG("one")}\n\n<!-- col -->\n${DIAG("two")}\n`,
    "col 表｜図｜図": `# T\n\n<!-- col -->\n${TABLE("1")}\n\n<!-- col -->\n${DIAG("one")}\n\n<!-- col -->\n${DIAG("two")}\n`,
  };
  for (const [name, md] of Object.entries(cases)) {
    it(name, () => {
      expect(roundTrip(md)).toBe(md);
      expect(parseMd(roundTrip(md))).toEqual(parseMd(md));
    });
  }
});

// ── コーパス（段 0 と同じ committed のもの）──
const ROOT = resolve(__dirname, "..");
const mdIn = (dir: string, skip: string[] = []) =>
  readdirSync(resolve(ROOT, dir)).filter((f) => f.endsWith(".md") && !skip.includes(f)).sort().map((f) => `${dir}/${f}`);
const CORPUS = [...mdIn("samples", ["README.md"]), ...mdIn("tests/fixtures/slideir-baseline")];
const corpusSlides: { file: string; i: number; slide: SlideIR }[] = CORPUS.flatMap((file) =>
  parseMd(readFileSync(resolve(ROOT, file), "utf8")).slides.map((slide, i) => ({ file, i, slide })),
);

/** The singular-field view — what every reader saw before #392 (behind image = a layer, not a body figure). */
function singulars(s: SlideIR) {
  return [
    s.table && { kind: "table", ...s.table },
    s.diagram && { kind: "diagram", ...s.diagram },
    s.mermaidBlock && { kind: "mermaid", ...s.mermaidBlock },
    s.code && { kind: "code", ...s.code },
    s.image && !s.image.behind && { kind: "image", ...s.image },
  ].filter(Boolean);
}

describe("#392 段 1 (d): 単一ビジュアルのスライドには figures を付けない", () => {
  it("corpus: figures は本文ビジュアル 2 つ以上のスライドにだけ付く（付かないスライドの単数フィールドは高々 1 つ）", () => {
    for (const { file, i, slide } of corpusSlides) {
      if (slide.figures) expect(slide.figures.length, `${file}#${i}`).toBeGreaterThanOrEqual(2);
      else expect(singulars(slide).length, `${file}#${i}`).toBeLessThanOrEqual(1);
    }
  });
  it("visuals.md の単一ビジュアル行は figures なし・複数ビジュアル行は figures あり", () => {
    const deck = parseMd(readFileSync(resolve(ROOT, "tests/fixtures/slideir-baseline/visuals.md"), "utf8"));
    const withFigures = deck.slides.filter((s) => s.figures).map((s) => s.placeholders.find((p) => p.idx === "15")?.paragraphs[0].segments[0].text);
    expect(withFigures).toEqual(["表と図（現状は重なる）", "col 表｜図", "図が 2 つ（現状は先の図が落ちる）"]);
  });
});

describe("#392 段 1 R8: ビジュアル一覧の経路は slideFigures 1 本 — 単数フィールドと figures の一致", () => {
  it("corpus: figures の無いスライドでは slideFigures == 単数フィールドの一覧", () => {
    for (const { file, i, slide } of corpusSlides) {
      if (!slide.figures) expect(slideFigures(slide), `${file}#${i}`).toEqual(singulars(slide));
    }
  });
  it("parser の出力では、figures の種類ごと 1 つ目 == 単数フィールド（slideFigures は figures をそのまま返す）", () => {
    const extra = [
      `# T\n\n${DIAG("one")}\n\n${DIAG("two")}`,
      `# T\n\n- 本文\n\n${TABLE("1")}\n\n${DIAG("d")}`,
      `# T\n\n![a](${PNG})\n\n![b](${PNG})`,
      `# T\n\n<!-- col -->\n${TABLE("1")}\n\n<!-- col -->\n${DIAG("one")}\n\n<!-- col -->\n${DIAG("two")}`,
      "# T\n\n```ts\na\n```\n\n```mermaid\ngantt\n  title x\n```\n\n```ts\nb\n```",
    ].map((md) => parseMd(md).slides[0]);
    const withFigures = [...corpusSlides.map((c) => c.slide), ...extra].filter((s) => s.figures);
    expect(withFigures.length).toBeGreaterThanOrEqual(extra.length);
    for (const s of withFigures) {
      expect(slideFigures(s)).toEqual(s.figures);
      const firstOfKind = new Map<string, unknown>();
      for (const f of s.figures!) if (!firstOfKind.has(f.kind)) firstOfKind.set(f.kind, f);
      const single = new Map(singulars(s).map((x) => [(x as { kind: string }).kind, x]));
      expect(firstOfKind).toEqual(single);
    }
  });
  it("単数フィールドを編集すると（GUI/MCP の現行経路）slideFigures の種類ごと 1 つ目に反映される", () => {
    const s = parseMd(`# T\n\n${DIAG("one")}\n\n${TABLE("1")}\n\n${DIAG("two")}`).slides[0];
    const edited: SlideIR = { ...s, diagram: { yaml: "nodes:\n  - id: new", placeholderIdx: "1" } };
    expect(slideFigures(edited).map((f) => f.kind)).toEqual(["diagram", "table", "diagram"]);
    expect((slideFigures(edited)[0] as { yaml: string }).yaml).toContain("id: new");
    expect((slideFigures(edited)[2] as { yaml: string }).yaml).toContain("id: two");
    const removed: SlideIR = { ...s, table: undefined };
    expect(slideFigures(removed).map((f) => f.kind)).toEqual(["diagram", "diagram"]);
  });
});

describe("#392 段 1: never-silent — 段 2 までは描かれない 2 つ目以降を figure-dropped で告知", () => {
  it("undrawnFigures = 単数フィールド以外（描画経路が読まないもの）", () => {
    const s = parseMd(`# T\n\n${DIAG("one")}\n\n${DIAG("two")}`).slides[0];
    expect(undrawnFigures(s)).toHaveLength(1);
    expect(undrawnFigures(parseMd(`# T\n\n${TABLE("1")}\n\n${DIAG("d")}`).slides[0])).toEqual([]);
    expect(undrawnFigures(parseMd(`# T\n\n${DIAG("d")}`).slides[0])).toEqual([]);
  });
  it("diagnoseDeck が figure-dropped（info）を 1 件出す・単一ビジュアルでは出さない", () => {
    const deck = parseMd(`# T\n\n${DIAG("one")}\n\n${DIAG("two")}\n\n---\n\n# U\n\n${DIAG("x")}`);
    const iss = diagnoseDeck(deck).filter((x) => x.id === "figure-dropped");
    expect(iss.map((x) => [x.slideIndex, x.level])).toEqual([[0, "info"]]);
    expect(iss[0].message).toContain("図の2つ目以降（1個）");
  });
});
