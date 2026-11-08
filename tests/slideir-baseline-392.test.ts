/**
 * slideir-baseline-392.test.ts — #392 段 0（既存動作の固定・テストのみ）: SlideIR スナップショットと
 * md round-trip の不動点。
 *
 * #392 は SlideIR に `figures?: FigureBlock[]` を足し、1 スライドに複数のビジュアルを持てるようにする
 * （段 1〜3）。その型変更の前に、現在の parse／serialize の結果を機械的に固定しておく。
 *
 * - コーパス: `samples/*.md`（README を除く）＋ `tests/fixtures/slideir-baseline/*.md`。どちらも commit 済み
 *   なので CI でも同じ件数を読む（gitignore のローカル専用ファイルは読まない）。
 * - fixture `visuals.md` はビジュアル 1 つ（図・表・コード・画像・画像の属性 `{x,y,w,h,fit,ar}`・背面画像）・
 *   本文＋ビジュアル・表＋図・col 内のビジュアル・同種 2 つ・Mermaid を 1 スライドずつ持つ。
 *
 * 更新手順: 挙動を意図して変えたときだけ `npx vitest run tests/slideir-baseline-392.test.ts -u` で
 * スナップショット（tests/__snapshots__/slideir-baseline-392.test.ts.snap）を書き直し、差分を読んでから commit する。
 * **#392 段 1 以降で変わってよいのは複数ビジュアルのケースだけ**（visuals.md の「表と図」「col 表｜図」
 * 「図が 2 つ」と、それを含むコーパスのスライド）。単一ビジュアルのスライドの差分は不変条件違反。
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { parseMd, parseMdReport } from "../src/engine/md-parser";
import { serializeMd } from "../src/engine/md-serializer";

const ROOT = resolve(__dirname, "..");
const mdIn = (dir: string, skip: string[] = []) =>
  readdirSync(resolve(ROOT, dir))
    .filter((f) => f.endsWith(".md") && !skip.includes(f))
    .sort()
    .map((f) => `${dir}/${f}`);

const CORPUS = [...mdIn("samples", ["README.md"]), ...mdIn("tests/fixtures/slideir-baseline")];
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

describe("#392 段 0: corpus is the committed one (CI reads the same files)", () => {
  it("lists every committed sample deck and the visuals fixture", () => {
    expect(CORPUS).toEqual([
      "samples/deck-01-mixed-layouts.md",
      "samples/deck-02-diagrams.md",
      "samples/deck-03-report-charts.md",
      "samples/deck-04-stress-edgecases.md",
      "samples/deck-05-report-form.md", // #597（PR #608）で追加された報告書版の基準デッキ
      "samples/manuscript-01-business-proposal.md",
      "samples/manuscript-02-tech-report.md",
      "samples/manuscript-03-howto-guide.md",
      "samples/manuscript-04-meeting-notes.md",
      "samples/manuscript-05-sales-pitch.md", // #595 で追加されたセールスピッチの目標デッキ
      "samples/manuscript-06-executive-brief.md", // #596 エグゼクティブの目標デッキ
      "samples/sample-deck.md",
      "tests/fixtures/slideir-baseline/visuals.md",
    ]);
  });
});

describe("#392 段 0: SlideIR snapshot (parseMdReport — deck + parse notices)", () => {
  for (const file of CORPUS) {
    it(file, () => {
      expect(parseMdReport(read(file))).toMatchSnapshot();
    });
  }
});

describe("#392 段 0: visuals.md — the per-slide visual fields, pinned explicitly", () => {
  // The same facts as the snapshot, but readable in the test: which visual sits at which ordinal
  // (placeholderIdx = 1-based body-region ordinal). Comments mark what #392 段 1/2 is expected to change.
  const deck = parseMdReport(read("tests/fixtures/slideir-baseline/visuals.md"));
  const at = (title: string) => {
    const s = deck.deck.slides.find((sl) =>
      sl.placeholders.some((p) => p.idx === "15" && p.paragraphs[0]?.segments[0]?.text === title),
    );
    if (!s) throw new Error(`no slide titled ${title}`);
    return {
      body: s.placeholders.map((p) => p.idx),
      diagram: s.diagram?.placeholderIdx,
      table: s.table?.placeholderIdx,
      code: s.code?.placeholderIdx,
      image: s.image && { idx: s.image.placeholderIdx, rect: s.image.rect, fit: s.image.fit, aspect: s.image.aspect, behind: s.image.behind },
      mermaid: s.mermaidBlock?.placeholderIdx,
    };
  };
  const none = { diagram: undefined, table: undefined, code: undefined, image: undefined, mermaid: undefined };
  const noImg = { idx: "1", rect: undefined, fit: undefined, aspect: undefined, behind: undefined };

  it("single visuals sit at ordinal 1 (solo)", () => {
    expect(at("図だけ")).toEqual({ ...none, body: ["15"], diagram: "1" });
    expect(at("表だけ")).toEqual({ ...none, body: ["15"], table: "1" });
    expect(at("コードだけ")).toEqual({ ...none, body: ["15"], code: "1" });
    expect(at("画像だけ")).toEqual({ ...none, body: ["15"], image: noImg });
  });
  it("image attrs {x,y,w,h,fit,ar} and behind=1 are carried on the image block", () => {
    expect(at("画像の属性つき")).toEqual({
      ...none, body: ["15", "1"],
      image: { idx: "1", rect: { x: 1.5, y: 2, w: 4, h: 3 }, fit: "cover", aspect: 1.333, behind: undefined },
    });
    expect(at("背面画像")).toEqual({ ...none, body: ["15", "1"], image: { ...noImg, behind: true } });
  });
  it("body text + one visual → the visual moves to ordinal 2 (#390)", () => {
    expect(at("本文と図")).toEqual({ ...none, body: ["15", "1"], diagram: "2" });
    expect(at("本文と表")).toEqual({ ...none, body: ["15", "1"], table: "2" });
    expect(at("本文とコード")).toEqual({ ...none, body: ["15", "1"], code: "2" });
  });
  it("col body | diagram → diagram at ordinal 2", () => {
    expect(at("col 本文｜図")).toEqual({ ...none, body: ["15", "1"], diagram: "2" });
  });
  it("a Mermaid state diagram stays a mermaid block at ordinal 1", () => {
    expect(at("Mermaid")).toEqual({ ...none, body: ["15"], mermaid: "1" });
  });
  it("col body | image → the image keeps ordinal 1 (current behavior; shares the ordinal with the body text)", () => {
    expect(at("col 本文｜画像")).toEqual({ ...none, body: ["15", "1"], image: noImg });
  });
  // ── cases #392 段 1/2 is EXPECTED to change ──
  it("[#392 で変わる予定] table + diagram (no col) → BOTH at ordinal 1 (the figure is drawn solo over the table)", () => {
    expect(at("表と図（現状は重なる）")).toEqual({ ...none, body: ["15"], diagram: "1", table: "1" });
  });
  it("[#392 で変わる予定] col table | diagram → table 1, diagram 2", () => {
    expect(at("col 表｜図")).toEqual({ ...none, body: ["15"], table: "1", diagram: "2" });
  });
  // #392 段 1 で変わった（旧: last wins で後の図だけが残り figure-dropped notice）: 両方が figures に出現順で残り、
  // 単数 diagram は 1 つ目。parse 時のドロップは無くなった（描画されないことの告知は deck-diagnostics 側）。
  it("[#392 段 1 で変更] two diagrams → both kept in figures (source order), the singular diagram is the FIRST, no notice", () => {
    const idx = deck.deck.slides.findIndex((sl) => sl.placeholders.some((p) => p.paragraphs[0]?.segments[0]?.text?.startsWith("図が 2 つ")));
    const s = deck.deck.slides[idx];
    expect(at("図が 2 つ（現状は先の図が落ちる）")).toEqual({ ...none, body: ["15"], diagram: "1" });
    expect(s.diagram!.yaml).toContain("id: one");
    expect(s.figures!.map((f) => (f.kind === "diagram" ? /id: (\w+)/.exec(f.yaml)![1] : f.kind))).toEqual(["one", "two"]);
    expect(deck.notices).toEqual([]);
  });
});

describe("#392 段 0: what the serializer writes back for visuals.md (pinned explicitly)", () => {
  const md1 = serializeMd(parseMd(read("tests/fixtures/slideir-baseline/visuals.md")));
  const back = parseMd(md1).slides;
  const slideMd = (title: string) => {
    const part = md1.split(/\n---\n/).find((p) => p.includes(`# ${title}`));
    if (!part) throw new Error(`no serialized slide titled ${title}`);
    return part;
  };
  const backOf = (title: string) => back.find((s) => s.placeholders.some((p) => p.idx === "15" && p.paragraphs[0]?.segments[0]?.text === title))!;

  it("single visuals and col body | diagram survive the round-trip", () => {
    for (const t of ["図だけ", "本文と図", "col 本文｜図"]) expect(backOf(t).diagram, t).toBeDefined();
    for (const t of ["表だけ", "本文と表"]) expect(backOf(t).table, t).toBeDefined();
    for (const t of ["コードだけ", "本文とコード"]) expect(backOf(t).code, t).toBeDefined();
    expect(slideMd("col 本文｜図")).toContain("<!-- col -->");
    expect(backOf("画像の属性つき").image).toMatchObject({ rect: { x: 1.5, y: 2, w: 4, h: 3 }, fit: "cover", aspect: 1.333 });
    expect(backOf("背面画像").image).toMatchObject({ behind: true });
  });
  it("col body | image is written back WITHOUT the col markers (body, then the image line) — current behavior", () => {
    expect(slideMd("col 本文｜画像")).not.toContain("<!-- col -->");
    expect(backOf("col 本文｜画像").image).toBeDefined();
  });
  it("[#392 で変わる予定] col table | diagram keeps both through the col markers", () => {
    expect(slideMd("col 表｜図")).toContain("<!-- col -->");
    expect(backOf("col 表｜図")).toMatchObject({ table: { placeholderIdx: "1" }, diagram: { placeholderIdx: "2" } });
  });
  // #392 段 1 で変更（旧: 表＋図が同じ ordinal で表だけが書き戻され、1 回の round-trip で図が消えていた）:
  // figures の出現順（表→図）で両方を書き戻す。
  it("[#392 段 1 で変更] table + diagram (no col): both are written back in source order and survive the round-trip", () => {
    const md = slideMd("表と図（現状は重なる）");
    expect(md).toContain("```diagram");
    expect(md.indexOf("| 指標 |")).toBeLessThan(md.indexOf("```diagram"));
    expect(backOf("表と図（現状は重なる）").table).toBeDefined();
    expect(backOf("表と図（現状は重なる）").diagram).toBeDefined();
  });
});

describe("#392 段 0: md round-trip is a fixed point over the whole corpus", () => {
  // serializeMd(parseMd(md)) normalizes once (md1); from then on parse→serialize must return md1 unchanged.
  // md1 itself is snapshotted, so the serializer's write-back order is pinned too (段 1 must keep it for
  // single-visual slides and define 出現順 for the multi-visual ones).
  for (const file of CORPUS) {
    it(file, () => {
      const md1 = serializeMd(parseMd(read(file)));
      expect(serializeMd(parseMd(md1))).toBe(md1);
      expect(md1).toMatchSnapshot();
    });
  }
});
