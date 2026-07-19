/**
 * gui-serialize-binding-plan-slide.test.ts — Issue #159: ADR-0030 段階B の GUI per-slide 残り配線。
 *
 * #155 で deck-level は deck-markdown.ts（BindingPlan 経由）へ集約済みだが、per-slide の 4 箇所
 * （flushHostSend / handleVisualizeSlide / previewSlideEdit.afterMd / currentSlideMd）は旧経路の
 * ままだった: catalog 解決で closing 語彙スライドが Closing.* に pin され、legacy readout の
 * 名前ベース名前空間が title を idx 0 から読む（parse 側は idx 15 に格納）→ per-slide エディタ／
 * AiPanel 入力からタイトルが消え、1 文字編集の parse-back でタイトルが本当に消える（データ損失
 * ループ）。
 *
 * 固定するのは per-slide 配線点 deck-markdown.slideMarkdown（hook は renderHook せず純粋関数を
 * 直接駆動 — #155 の流儀）＋ components から serializeMd 直呼びを per-slide リテラル込みで
 * 全面的に締め出す tripwire。手本: tests/gui-serialize-binding-plan.test.ts（deck-level の同型）。
 *
 * 絶対不変条件: 健全テンプレ（規約 idx のみ）の per-slide md は旧経路と byte-identical。
 * collab の sendSlideMarkdown 経路はホストの parse と往復一致（fixpoint）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { loadTemplate, autoSelectLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog, type LayoutCatalog } from "../src/engine/template-catalog";
import { parseMd } from "../src/engine/md-parser";
import { serializeMd } from "../src/engine/md-serializer";
import { distillDeck } from "../src/engine/distill";
import type { DeckIR, SlideIR } from "../src/engine/slide-schema";
import { slideMarkdown } from "../src/components/deck-markdown";

const fx = (p: string) => readFileSync(resolve(__dirname, "fixtures/templates", p));

// #144/#155/#159 共通 repro: 表紙(meta 付き) + closing 語彙タイトルの本文スライド。
const REPRO_MD = "# 表紙\n\nCategory: X\n\n---\n\n# まとめ\n\n- 論点A\n- 論点B\n";
const HEALTHY_MD =
  "# 表紙\n\n## サブ\n\nCategory: 部門\n\n---\n\n# 本文\n\n- a\n- b\n\n---\n\n# 比較\n\n<!-- col -->\n- 左\n\n<!-- col -->\n- 右\n";

/** GUI の Draft 経路そのもの（useDeckController.commitParse と同じ）: parseMd → distillDeck。 */
async function guiDeck(file: string, md: string) {
  const template: TemplateData = await loadTemplate(fx(file));
  const catalog = buildCatalog(template);
  const deck = distillDeck(parseMd(md), catalog);
  return { template, catalog, deck };
}

/** currentSlideMd / previewSlideEdit の解決規則（無条件 resolve → pin）。 */
function editorResolved(deck: DeckIR, i: number, catalog: LayoutCatalog | undefined): SlideIR {
  const s = deck.slides[i];
  return { ...s, layout: autoSelectLayout(s, i, deck.slides.length, catalog) };
}

/** flushHostSend / handleVisualizeSlide の解決規則（auto のみ resolve）。 */
function sendResolved(deck: DeckIR, i: number, catalog: LayoutCatalog | undefined): SlideIR {
  const s = deck.slides[i];
  return { ...s, layout: s.layout === "auto" ? autoSelectLayout(s, i, deck.slides.length, catalog) : s.layout };
}

describe("issue #159 — per-slide readout（currentSlideMd / AiPanel 入力）が BindingPlan 経由", () => {
  it("Midnight + closing 語彙: resolved pin + tpl でタイトルと箇条書きの内容が残る", async () => {
    const { template, catalog, deck } = await guiDeck("Midnight_Executive_30_TemplateOnly.pptx", REPRO_MD);
    const md = slideMarkdown(editorResolved(deck, 1, catalog), catalog, template);
    expect(md).toContain("# まとめ");
    expect(md).toContain("論点A");
    expect(md).toContain("論点B");
  });

  it("Dirty_Legacy43: タイトルが残り、箇条書きは本文のまま（## 化しない）", async () => {
    const { template, catalog, deck } = await guiDeck("Dirty_Legacy43_TemplateOnly.pptx", REPRO_MD);
    expect(slideMarkdown(editorResolved(deck, 1, catalog), catalog, template)).toBe(
      "<!-- slide: 図表 -->\n# まとめ\n\n- 論点A\n- 論点B\n",
    );
  });

  it("per-slide エディタのデータ損失ループが閉じる: parse-back → 再 readout が fixpoint", async () => {
    // handleSlideMdChange は parseMd(md).slides[0] でスライドを置換し、currentSlideMd が再 readout
    // する。旧経路はこの一周でタイトルが本当に消えた。新経路は一周が恒等（タイトル保持）であること。
    for (const file of ["Midnight_Executive_30_TemplateOnly.pptx", "Dirty_Legacy43_TemplateOnly.pptx"]) {
      const { template, catalog, deck } = await guiDeck(file, REPRO_MD);
      const md1 = slideMarkdown(editorResolved(deck, 1, catalog), catalog, template);
      const back = parseMd(md1).slides[0];
      expect(back).toBeDefined();
      const md2 = slideMarkdown(
        { ...back, layout: autoSelectLayout(back, 1, deck.slides.length, catalog) },
        catalog,
        template,
      );
      expect(md2).toBe(md1);
      expect(md2).toContain("# まとめ");
    }
  });
});

describe("issue #159 — collab flushHostSend 経路（sendSlideMarkdown ↔ ホスト parse の往復一致）", () => {
  it("Midnight + closing 語彙: 送信 md にタイトルが残り、ホストの parse → readout が送信 md と一致", async () => {
    const { template, catalog, deck } = await guiDeck("Midnight_Executive_30_TemplateOnly.pptx", REPRO_MD);
    const sent = slideMarkdown(sendResolved(deck, 1, catalog), catalog, template);
    expect(sent).toContain("# まとめ");
    // ホスト側（applySlideMarkdown）: parseMd → 差し替え → slideToMarkdown（条件 resolve + tpl）。
    const host = parseMd(sent).slides[0];
    expect(host).toBeDefined();
    const hostBack = slideMarkdown(
      { ...host, layout: host.layout === "auto" ? autoSelectLayout(host, 1, deck.slides.length, catalog) : host.layout },
      catalog,
      template,
    );
    expect(hostBack).toBe(sent);
  });
});

describe("issue #159 — 絶対不変条件: 健全スライドの per-slide md は旧経路と byte-identical", () => {
  it("Midnight 健全デッキ: 全スライド（Title / Content / Column）で新旧一致", async () => {
    const { template, catalog, deck } = await guiDeck("Midnight_Executive_30_TemplateOnly.pptx", HEALTHY_MD);
    for (let i = 0; i < deck.slides.length; i++) {
      const pinned = editorResolved(deck, i, catalog);
      expect(slideMarkdown(pinned, catalog, template)).toBe(serializeMd({ slides: [pinned] }));
    }
  });

  it("テンプレ未ロード（catalog/template なし）は旧経路と byte-identical", async () => {
    const { deck } = await guiDeck("Midnight_Executive_30_TemplateOnly.pptx", REPRO_MD);
    const pinned = editorResolved(deck, 1, undefined);
    expect(slideMarkdown(pinned, undefined, null)).toBe(serializeMd({ slides: [pinned] }));
  });
});

describe("issue #159 — ガード: components は serializeMd を直接呼ばない（per-slide リテラル込み）", () => {
  // #155 の tripwire は deck 変数を渡す形だけを見ていた（per-slide の serializeMd({ slides: [...] })
  // リテラルは宣言済みの残課題として対象外）。本 Issue で per-slide も deck-markdown.ts 経由に
  // なったので、呼び出し形を問わず serializeMd( の出現そのものを締め出す。
  it("serializeMd( の出現は deck-markdown.ts と宣言済み例外だけ", () => {
    const dir = resolve(__dirname, "../src/components");
    // 許可: deck-markdown.ts（唯一の配線点）／ ai-generation-types.ts:128（deckPlanToDeck は
    // canonical 名と一致する idx で内容を構築するため、名前空間乖離が構造的に起きない）
    const allow = new Set(["deck-markdown.ts", "ai-generation-types.ts"]);
    const offenders: string[] = [];
    for (const f of readdirSync(dir).filter((n) => /\.tsx?$/.test(n))) {
      if (allow.has(f)) continue;
      const hits = readFileSync(resolve(dir, f), "utf8").match(/\bserializeMd\(/g);
      if (hits) offenders.push(`${f} (${hits.length})`);
    }
    const appHits = readFileSync(resolve(__dirname, "../src/App.tsx"), "utf8").match(/\bserializeMd\(/g);
    if (appHits) offenders.push(`App.tsx (${appHits.length})`);
    expect(offenders).toEqual([]);
  });
});
