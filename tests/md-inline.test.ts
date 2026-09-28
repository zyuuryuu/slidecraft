/**
 * md-inline.test.ts — #393: インラインコード・リンク・取消線が記法ごと印字される問題の受け入れ基準。
 * Written before the fix (R3).
 *
 * - parse: `` `x` `` → code、`[t](url)` → href 付きの表示テキスト t、`~~x~~` → strike。記号は残らない
 * - 不変条件: 新記法を含まない文字列は旧パーサ（bold/italic のみ）と segments が完全一致
 *   （ただし旧パーサが黙って捨てていた「対にならない `*`」はリテラルとして残す — no-silent-drop）
 * - round-trip: parse → serialize → parse が同値（例示＋ランダム文字列）
 * - PPTX: リンクは <a:hlinkClick r:id> ＋ slide rels に External な hyperlink Relationship
 *   （本文・スピーカーノートとも）。取消線は strike="sngStrike"
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import JSZip from "jszip";
import { parseInline, serializeInline } from "../src/engine/md-inline";
import { parseMd } from "../src/engine/md-parser";
import { serializeMd } from "../src/engine/md-serializer";
import { paragraphsToOoxml } from "../src/engine/md-to-ooxml";
import { generatePptx } from "../src/engine/placeholder-filler";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import type { InlineSegment, SlideIR } from "../src/engine/slide-schema";

const TEMPLATE_PATH = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");

/** 行位置メタ（エディタ用 sourceLineStart/End）を除いた内容のみ — serializer は末尾改行を足すため行番号はずれ得る。 */
const content = (slides: SlideIR[]) =>
  slides.map((s) => {
    const rest = { ...s };
    delete rest.sourceLineStart;
    delete rest.sourceLineEnd;
    return rest;
  });

/** 旧 parseInline（#393 以前・bold/italic のみ）の逐語コピー＝互換性のオラクル。 */
function legacyParseInline(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*|([^*]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[2]) segments.push({ text: m[2], bold: true });
    else if (m[3]) segments.push({ text: m[3], italic: true });
    else if (m[4]) segments.push({ text: m[4] });
  }
  return segments.length > 0 ? segments : [{ text }];
}

/** Deterministic PRNG (mulberry32) — ランダム文字列テストを再現可能にする。 */
function rng(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomString(next: () => number, alphabet: string[], maxLen: number): string {
  const len = 1 + Math.floor(next() * maxLen);
  let s = "";
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(next() * alphabet.length)];
  return s;
}

describe("parseInline — #393 新記法", () => {
  it("repro: `code` / [リンク](url) / ~~取消線~~ の記号が segments に残らない", () => {
    const segs = parseInline("`inline code` と [リンク](https://example.com) と ~~取消線~~");
    expect(segs).toEqual([
      { text: "inline code", code: true },
      { text: " と " },
      { text: "リンク", href: "https://example.com" },
      { text: " と " },
      { text: "取消線", strike: true },
    ]);
  });

  it("コードスパン内の * や [ はリテラル（強調・リンクにならない）", () => {
    expect(parseInline("`a*b*c [x](https://e.x)`")).toEqual([{ text: "a*b*c [x](https://e.x)", code: true }]);
  });

  it("http/https/mailto 以外のリンク先はリンク化しない（記法ごとリテラルで残す）", () => {
    expect(parseInline("[x](javascript:alert(1))")).toEqual([{ text: "[x](javascript:alert(1))" }]);
    expect(parseInline("[x](./rel/path)")).toEqual([{ text: "[x](./rel/path)" }]);
    // 画像記法（本文に落ちた ![alt](src)）はリンクにしない — #148 の残留画像診断が文字列で検知するため
    expect(parseInline("![外部](https://example.com/x.png)")).toEqual([{ text: "![外部](https://example.com/x.png)" }]);
    expect(parseInline("[メール](mailto:a@b.c)")).toEqual([{ text: "メール", href: "mailto:a@b.c" }]);
    expect(parseInline("[x](HTTPS://E.X/a?b=1&c=2)")).toEqual([{ text: "x", href: "HTTPS://E.X/a?b=1&c=2" }]);
  });

  it("閉じない記号はリテラルのまま（`a ~ b`, `[x]`, `単独の \\`` 等）", () => {
    expect(parseInline("10~20 と ~~閉じない")).toEqual([{ text: "10~20 と ~~閉じない" }]);
    expect(parseInline("配列 [0] と `単独")).toEqual([{ text: "配列 [0] と `単独" }]);
  });

  it("対にならない * は落とさずリテラルで残す（旧パーサの silent drop を解消）", () => {
    expect(parseInline("*注 本表は概算")).toEqual([{ text: "*注 本表は概算" }]);
    expect(parseInline("a * b")).toEqual([{ text: "a * b" }]);
    expect(parseInline("**a")).toEqual([{ text: "**a" }]);
    // 旧パーサは末尾の * を捨てて [{bold "*三重"}] だった（三重強調は元々非対応）。落とさず残す。
    expect(parseInline("***三重***")).toEqual([{ text: "*三重", bold: true }, { text: "*" }]);
  });

  it("新記法と bold/italic の混在", () => {
    expect(parseInline("**太字** と `x` と *斜体*")).toEqual([
      { text: "太字", bold: true },
      { text: " と " },
      { text: "x", code: true },
      { text: " と " },
      { text: "斜体", italic: true },
    ]);
  });
});

describe("parseInline — 記法なし/旧記法の互換（byte-identical の担保）", () => {
  const CORPUS = [
    "",
    "プレーンな本文",
    "**太字** と *斜体* の混在",
    "**a** **b**",
    "*a**b*",
    "文中の **強調** です。",
    "100% (前年比) — 比較: A/B | C",
    "<!-- comment --> & \"quote\"",
  ];
  it("代表コーパスで旧パーサと完全一致", () => {
    for (const s of CORPUS) expect(parseInline(s), s).toEqual(legacyParseInline(s));
  });

  it("ランダム文字列（新記法の記号 ` [ ~ を含まず、* は対になる）で旧パーサと完全一致", () => {
    // 旧パーサは対にならない * を捨てていた（仕様外の silent drop）。その差分だけを除外するため、
    // 旧パーサが何も捨てていない（出力テキスト連結＝ * を除いた入力と整合）ケースで比較する。
    const next = rng(393);
    const alphabet = ["a", "b", " ", "*", "**", "あ", "(", ")", "]", "!"];
    let compared = 0;
    for (let i = 0; i < 3000; i++) {
      const s = randomString(next, alphabet, 12);
      const legacy = legacyParseInline(s);
      const rebuilt = legacy
        .map((g) => (g.bold ? `**${g.text}**` : g.italic ? `*${g.text}*` : g.text))
        .join("");
      if (rebuilt !== s) continue; // 旧パーサが文字を捨てたケース（別途上で仕様化）
      compared++;
      expect(parseInline(s), JSON.stringify(s)).toEqual(legacy);
    }
    expect(compared).toBeGreaterThan(1000);
  });
});

describe("serializeInline / round-trip (parse → serialize → parse 同値)", () => {
  it("各記法を同じ記法へ書き戻す", () => {
    const src = "`inline code` と [リンク](https://example.com) と ~~取消線~~ と **太** と *斜*";
    expect(serializeInline(parseInline(src))).toBe(src);
  });

  it("ランダム文字列で parse → serialize → parse が同値", () => {
    const next = rng(395);
    const alphabet = ["a", " ", "*", "`", "~", "[", "]", "(", ")", "https://e.x", "あ", "~~", "**", "!"];
    for (let i = 0; i < 5000; i++) {
      const s = randomString(next, alphabet, 14);
      const once = parseInline(s);
      const twice = parseInline(serializeInline(once));
      expect(twice, JSON.stringify(s)).toEqual(once);
    }
  });

  it("parseMd → serializeMd → parseMd でデッキ全体が同値（本文・タイトル・ノート）", () => {
    const md = `# \`API\` の [仕様](https://example.com/spec) 改訂

- \`inline code\` と [リンク](https://example.com) と ~~取消線~~
- **太字** はそのまま

<!-- note -->
詳細は [社内 wiki](https://wiki.example.com/x?a=1&b=2) を参照`;
    const deck1 = parseMd(md);
    const deck2 = parseMd(serializeMd(deck1));
    expect(content(deck2.slides)).toEqual(content(deck1.slides));
    const body = deck1.slides[0].placeholders.find((p) => p.idx === "1")!;
    expect(body.paragraphs[0].segments).toEqual([
      { text: "inline code", code: true },
      { text: " と " },
      { text: "リンク", href: "https://example.com" },
      { text: " と " },
      { text: "取消線", strike: true },
    ]);
  });
});

describe("OOXML runs — #393", () => {
  it("取消線は strike=\"sngStrike\"・コードは記号なしの素の run", () => {
    const xml = paragraphsToOoxml([{ segments: parseInline("`x` ~~y~~") }]);
    expect(xml).toBe(
      `<a:p><a:pPr><a:buNone/></a:pPr><a:r><a:t>x</a:t></a:r><a:r><a:t> </a:t></a:r>` +
        `<a:r><a:rPr strike="sngStrike"/><a:t>y</a:t></a:r></a:p>`,
    );
  });

  it("リンクはリゾルバの rId で <a:hlinkClick> を持つ", () => {
    const xml = paragraphsToOoxml([{ segments: [{ text: "t", href: "https://e.x", bold: true }] }], () => "rId7");
    expect(xml).toContain(`<a:r><a:rPr b="1"><a:hlinkClick r:id="rId7"/></a:rPr><a:t>t</a:t></a:r>`);
  });

  it("IR に直接入った危険な href（JSON/MCP 経由）は hlinkClick にしない", () => {
    const xml = paragraphsToOoxml([{ segments: [{ text: "t", href: "javascript:alert(1)" }] }], () => "rId7");
    expect(xml).not.toContain("hlinkClick");
  });

  it("旧記法だけの段落はリゾルバの有無で出力が変わらない", () => {
    const paras = [{ segments: parseInline("**a** *b* c") }];
    expect(paragraphsToOoxml(paras, () => "rId9")).toBe(paragraphsToOoxml(paras));
  });
});

describe("PPTX — hlinkClick の rels 配線 (#393)", () => {
  let tpl: TemplateData;
  beforeAll(async () => {
    tpl = await loadTemplate(readFileSync(TEMPLATE_PATH));
  });

  const MD = `# リンク

- \`inline code\` と [リンク](https://example.com) と ~~取消線~~
- 同じ先 [再掲](https://example.com) と [別](https://example.org/?a=1&b=2)

<!-- note -->
ノートの [参考](https://notes.example.com)

---

# リンクなし

- 本文だけ`;

  it("本文リンク: run に hlinkClick、rels に External hyperlink（同一 URL は 1 本に集約）", async () => {
    const zip = await JSZip.loadAsync(await generatePptx(parseMd(MD), tpl));
    const slide = await zip.file("ppt/slides/slide1.xml")!.async("string");
    const rels = await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string");

    const texts = [...slide.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join("");
    expect(texts).not.toMatch(/[`~]|\[|\]\(/);

    const rids = [...slide.matchAll(/<a:hlinkClick r:id="(rId\d+)"\/>/g)].map((m) => m[1]);
    expect(rids.length).toBe(3);
    expect(new Set(rids).size).toBe(2);
    const relOf = (rid: string) =>
      rels.match(new RegExp(`<Relationship Id="${rid}"[^>]*/>`))?.[0] ?? "";
    expect(relOf(rids[0])).toContain(`Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"`);
    expect(relOf(rids[0])).toContain(`Target="https://example.com"`);
    expect(relOf(rids[0])).toContain(`TargetMode="External"`);
    expect(relOf(rids[2])).toContain(`Target="https://example.org/?a=1&amp;b=2"`);
    // 既存の予約 rId（layout=rId1・画像=rId2/3・notes=rId4）と衝突しない
    for (const r of rids) expect(Number(r.slice(3))).toBeGreaterThanOrEqual(5);
    expect(slide).toContain(`strike="sngStrike"`);
  });

  it("ノート内リンク: notesSlide の rels に hyperlink が配線される", async () => {
    const zip = await JSZip.loadAsync(await generatePptx(parseMd(MD), tpl));
    const notes = await zip.file("ppt/notesSlides/notesSlide1.xml")!.async("string");
    const nrels = await zip.file("ppt/notesSlides/_rels/notesSlide1.xml.rels")!.async("string");
    const rid = notes.match(/<a:hlinkClick r:id="(rId\d+)"\/>/)?.[1];
    expect(rid).toBeDefined();
    expect(nrels).toMatch(new RegExp(`<Relationship Id="${rid}"[^>]*Target="https://notes\\.example\\.com"[^>]*TargetMode="External"/>`));
    expect(nrels).toContain(`Id="rId1"`); // notesMaster
    expect(nrels).toContain(`Id="rId2"`); // parent slide
  });

  it("リンクの無いスライドの rels には hyperlink が現れない", async () => {
    const zip = await JSZip.loadAsync(await generatePptx(parseMd(MD), tpl));
    const rels = await zip.file("ppt/slides/_rels/slide2.xml.rels")!.async("string");
    expect(rels).not.toContain("hyperlink");
  });
});
