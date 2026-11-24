/**
 * issue-747-roundtrip-col-fallback.test.ts — #747: テンプレ無しの md round-trip で、文字だけの 2 列
 * スライドの `<!-- col -->` が落ちていた。
 *
 * 素の `<!-- col -->` は groupKind を持たず、layout "auto" では getSeparatorType が null → legacy
 * 経路（serializeLegacy）は単一本文として idx 1 と idx 2 を空行区切りで書いていた。再パースすると
 * idx 2（締めの連絡先・選択肢）が idx 1 に吸収される。テンプレ付き経路（serializeByPlan）には
 * 「title ＋ 本文領域 2 つ → col」のフォールバックがあり、同じ写像（スライド → 区切り種別）を 2 経路で
 * 別々に計算して食い違っていた（R8）。区切り判定を md-serializer-shared.ts の 1 関数に一本化した。
 *
 * 到達性: tpl 無しの serializeMd は製品から呼ばれる（AI 生成結果 src/components/ai-generation-types.ts の
 * shapeDeckResult・テンプレ未ロード時の deck-markdown.ts・tpl に無い layout 名の slide）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parseMd } from "../src/engine/md-parser";
import { serializeMd } from "../src/engine/md-serializer";
import type { SlideIR } from "../src/engine/slide-schema";
import * as S from "../src/mcp/session";

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");
const fx = (p: string) => readFileSync(resolve(__dirname, "fixtures/templates", p));

/** placeholder idx → 本文テキスト（段落の先頭 segment を連結）。idx の写像そのものを比べる。 */
const byIdx = (s: SlideIR) =>
  Object.fromEntries(
    s.placeholders.map((p) => [p.idx, p.paragraphs.map((q) => q.segments.map((g) => g.text).join("")).join("\n")]),
  );

describe("#747 — tpl 無しの parseMd → serializeMd → parseMd で 2 列スライドの idx が変わらない", () => {
  for (const [file, title] of [
    ["samples/manuscript-05-sales-pitch.md", "次のステップ"],
    ["samples/manuscript-06-executive-brief.md", "本日ご相談したいこと"],
  ] as const) {
    it(`${file}: 締め「${title}」の列が残る`, () => {
      const once = parseMd(read(file));
      const back = parseMd(serializeMd(once));
      const find = (d: typeof once) => d.slides.find((s) => byIdx(s)["15"] === title)!;
      expect(byIdx(find(once))["2"]).toBeDefined(); // 前提: 2 列目（連絡先・選択肢）は idx 2
      expect(byIdx(find(back))).toEqual(byIdx(find(once)));
      const part = serializeMd(once).split(/\n---\n/).find((p) => p.includes(`# ${title}`))!;
      expect(part.match(/<!-- col -->/g)).toHaveLength(2);
    });
  }
});

describe("#747 — 区切り判定の一致（R8）: 文字だけの 2 列スライドで legacy と plan が byte-identical", () => {
  // 締め（最終・closing 語彙の title）: catalog 無しの autoSelectLayout は Closing.1Steps.Single+1Notes に
  // 解決し getSeparatorType が null になる＝legacy がフォールバックを持たないと食い違うケース。
  const MD =
    "# 表紙\n\n---\n\n# 中身\n\n- a\n\n---\n\n" +
    "# 次のステップ\n\n<!-- col -->\n- 11 月中: 選定\n- 12 月: 開始\n\n<!-- col -->\n連絡先: pj@example.com";
  it.each([["Midnight_Executive_30_TemplateOnly.pptx"], ["Dirty_Legacy43_TemplateOnly.pptx"]])("%s", async (file) => {
    const s = S.createSession();
    await S.newProject(s, fx(file), MD);
    const deck = S.getDeck(s);
    const withPlan = serializeMd(deck, { catalog: s.catalog!, layouts: s.template!.layouts });
    expect(serializeMd(deck)).toBe(withPlan);
    expect(withPlan.match(/<!-- col -->/g)).toHaveLength(2);
  });
});

describe("#747 — 区切りの無いスライドは従来どおり（固定）", () => {
  it("title ＋ 本文 1 つ: 単一本文のまま", () => {
    expect(serializeMd(parseMd("# 題\n\n- a\n- b"))).toBe("# 題\n\n- a\n- b\n");
  });
  it("title 無しで idx 1・2 に本文: 列にしない（フォールバックは title 必須）", () => {
    const slide: SlideIR = {
      layout: "auto",
      placeholders: [
        { idx: "1", paragraphs: [{ segments: [{ text: "一" }] }] },
        { idx: "2", paragraphs: [{ segments: [{ text: "二" }] }] },
      ],
    };
    expect(serializeMd({ slides: [slide] })).toBe("\n一\n\n二\n");
  });
});
