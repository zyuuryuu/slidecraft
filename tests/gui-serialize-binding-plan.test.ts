/**
 * gui-serialize-binding-plan.test.ts — Issue #155: ADR-0030 段階B の GUI（components）残り配線。
 *
 * #144 で serializeMd(deck, tpl?) は BindingPlan 消費に対応し MCP session 側は配線済みだが、
 * GUI の deck-level 呼び出し（Markdown ビュー同期・保存・.scft オープン・AI 系 before/after）は
 * 旧経路（catalog なし）のままだった: auto スライドが canonical fallback 名（closing 語彙→
 * Closing.*）に解決され、title 名前空間で誤読 → Markdown ビュー/保存 md でタイトル消失。
 *
 * このテストは GUI 側の deck-level serialize 経路（src/components/deck-markdown.ts — 各 hook は
 * ここを一行で呼ぶ）を、この repo の流儀（hook は renderHook せず純粋関数を直接駆動）で固定する。
 * 手本: tests/serializer-binding-plan.test.ts（session 経路の同型ゲート）。
 *
 * 絶対不変条件: 健全テンプレ（規約 idx のみ）の md は旧経路と byte-identical。
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";
import { parseMd } from "../src/engine/md-parser";
import { serializeMd } from "../src/engine/md-serializer";
import { distillDeck } from "../src/engine/distill";
import { refineDeck, batchEditDeck, type AiFixOutcome } from "../src/engine/refine";
import { reconcileSlideEdit } from "../src/engine/ai-apply";
import { deckMarkdown, deckMarkdownForTemplate, serializeTpl } from "../src/components/deck-markdown";

const fx = (p: string) => readFileSync(resolve(__dirname, "fixtures/templates", p));

// Issue #144/#155 の repro をそのまま固定: 表紙(meta 付き) + closing 語彙タイトルの本文スライド。
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

describe("issue #155 — GUI deck-level serialize（Markdown ビュー / 保存）が BindingPlan 経由", () => {
  it("Dirty_Legacy43: タイトルが残り、箇条書きは本文のまま（## 化しない）", async () => {
    const { template, catalog, deck } = await guiDeck("Dirty_Legacy43_TemplateOnly.pptx", REPRO_MD);
    expect(deckMarkdown(deck, catalog, template)).toBe(REPRO_MD);
  });

  it("canonical (Midnight): closing 語彙タイトルの最終スライドでもタイトルが残る", async () => {
    const { template, catalog, deck } = await guiDeck("Midnight_Executive_30_TemplateOnly.pptx", REPRO_MD);
    expect(deckMarkdown(deck, catalog, template)).toContain("# まとめ");
  });

  it("健全デッキ (Midnight): 新経路は旧経路と byte-identical", async () => {
    const { template, catalog, deck } = await guiDeck("Midnight_Executive_30_TemplateOnly.pptx", HEALTHY_MD);
    expect(deckMarkdown(deck, catalog, template)).toBe(serializeMd(deck));
  });

  it("テンプレ未ロード（catalog/template なし）は旧経路と byte-identical", async () => {
    const { deck } = await guiDeck("Midnight_Executive_30_TemplateOnly.pptx", REPRO_MD);
    expect(deckMarkdown(deck, undefined, null)).toBe(serializeMd(deck));
  });
});

describe("issue #155 — .scft オープン経路（開いたプロジェクト自身の template で束縛）", () => {
  it("Dirty_Legacy43: openProjectBytes 相当の readout でタイトルが残る", async () => {
    const { template, catalog } = await guiDeck("Dirty_Legacy43_TemplateOnly.pptx", REPRO_MD);
    const deck = distillDeck(parseMd(REPRO_MD), catalog);
    expect(deckMarkdownForTemplate(deck, template)).toBe(REPRO_MD);
  });

  it("健全デッキ (Midnight): 旧経路と byte-identical", async () => {
    const { template, deck } = await guiDeck("Midnight_Executive_30_TemplateOnly.pptx", HEALTHY_MD);
    expect(deckMarkdownForTemplate(deck, template)).toBe(serializeMd(deck));
  });
});

describe("issue #155 — AI 系 before md（refine.ts:71 = slideToMd の tpl 貫通）", () => {
  const echoCapture = (reqs: string[]) => async (req: string): Promise<AiFixOutcome> => {
    reqs.push(req);
    return { ok: false, cancelled: true };
  };

  it("Midnight + closing 語彙: batchEditDeck が AI に渡す before md にタイトルが残る", async () => {
    const { template, catalog, deck } = await guiDeck("Midnight_Executive_30_TemplateOnly.pptx", REPRO_MD);
    const reqs: string[] = [];
    await batchEditDeck(deck, catalog, {
      indices: [1],
      instruction: "整えて",
      aiFix: echoCapture(reqs),
      tpl: serializeTpl(catalog, template),
    });
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toContain("# まとめ");
  });

  it("Midnight + closing 語彙: refineDeck(level 2) の change-log beforeMd にタイトルが残る", async () => {
    // refineDeck 自身の opts.tpl → slideToMd 貫通を固定する（batchEditDeck と別の呼び出し行）。
    // key-value 3 件 → visualize レバーが level 2 で決定的に発火し、AI なしで beforeMd を観測できる。
    const md = "# 表紙\n\nCategory: X\n\n---\n\n# まとめ\n\n- 売上: 120億円\n- 利益: 30億円\n- 社員: 500名\n";
    const { template, catalog, deck } = await guiDeck("Midnight_Executive_30_TemplateOnly.pptx", md);
    const { changes } = await refineDeck(deck, catalog, { level: 2, tpl: serializeTpl(catalog, template) });
    const change = changes.find((c) => c.slideIndex === 1);
    expect(change).toBeDefined();
    expect(change!.beforeMd).toContain("# まとめ");
  });

  it("健全デッキ (Midnight): tpl あり/なしで before md は byte-identical", async () => {
    const { template, catalog, deck } = await guiDeck("Midnight_Executive_30_TemplateOnly.pptx", HEALTHY_MD);
    const withTpl: string[] = [];
    const without: string[] = [];
    await batchEditDeck(deck, catalog, { indices: [1, 2], instruction: "x", aiFix: echoCapture(withTpl), tpl: serializeTpl(catalog, template) });
    await batchEditDeck(deck, catalog, { indices: [1, 2], instruction: "x", aiFix: echoCapture(without) });
    expect(withTpl).toEqual(without);
  });
});

describe("issue #155 — reconcileSlideEdit（ai-apply.ts:129）の before 側 fact-check", () => {
  it("closing 語彙タイトル中の数値が before md に載る＝AI がその数値を落とすと警告される", async () => {
    // closing 語彙 + 数値のタイトル。旧経路は auto を catalog なしで解決 → Closing.* fallback →
    // title 名前空間で誤読 → before 側からタイトル（と 120 億円）が消え、数値ドロップが検知できなかった。
    const md = "# 表紙\n\nCategory: X\n\n---\n\n# まとめ：売上120億円\n\n- 論点A\n- 論点B\n";
    const { template, catalog, deck } = await guiDeck("Midnight_Executive_30_TemplateOnly.pptx", md);
    const rec = reconcileSlideEdit(deck.slides[1], "# まとめ\n\n- 論点A\n- 論点B\n", serializeTpl(catalog, template));
    expect(rec).not.toBeNull();
    expect(rec!.warnings.some((w) => w.includes("数値"))).toBe(true);
  });

  it("健全スライド: tpl あり/なしで reconcile 結果（slide/warnings）は一致", async () => {
    const { template, catalog, deck } = await guiDeck("Midnight_Executive_30_TemplateOnly.pptx", HEALTHY_MD);
    const raw = "# 本文\n\n- a\n- b\n- c\n";
    const withTpl = reconcileSlideEdit(deck.slides[1], raw, serializeTpl(catalog, template));
    const without = reconcileSlideEdit(deck.slides[1], raw);
    expect(withTpl).toEqual(without);
  });
});

describe("issue #155 — ガード: components は deck-level serializeMd を直接呼ばない", () => {
  // hook 配線はこの repo の流儀（renderHook なし）では直接テストできない。その代わり、deck 変数を
  // 直接 serializeMd に渡す形を deck-markdown.ts 以外から締め出す tripwire で「hook が旧経路に
  // 戻っても全緑」という mutation ギャップを塞ぐ。per-slide の serializeMd({ slides: [...] })
  // リテラル（Issue #155 で宣言済みの残課題）は第一引数が `{` なので対象外。
  it("deck を直接渡す serializeMd( は deck-markdown.ts と宣言済み例外だけ", () => {
    const dir = resolve(__dirname, "../src/components");
    // 許可: deck-markdown.ts（唯一の配線点）／ ai-generation-types.ts:128（deckPlanToDeck は
    // canonical 名と一致する idx で内容を構築するため、名前空間乖離が構造的に起きない）
    const allow = new Set(["deck-markdown.ts", "ai-generation-types.ts"]);
    const offenders: string[] = [];
    for (const f of readdirSync(dir).filter((n) => /\.tsx?$/.test(n))) {
      if (allow.has(f)) continue;
      const hits = readFileSync(resolve(dir, f), "utf8").match(/serializeMd\(\s*[A-Za-z_$]/g);
      if (hits) offenders.push(`${f} (${hits.length})`);
    }
    const appHits = readFileSync(resolve(__dirname, "../src/App.tsx"), "utf8").match(/serializeMd\(\s*[A-Za-z_$]/g);
    if (appHits) offenders.push(`App.tsx (${appHits.length})`);
    expect(offenders).toEqual([]);
  });
});
