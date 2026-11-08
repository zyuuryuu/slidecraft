/**
 * statement-quote-markers-593.test.ts — #593 後半: `<!-- statement -->` / `<!-- quote -->` マーカー。
 *
 * 統括裁定（PR #607）: マーカーは SlideIR.groupKind の enum 追加（"statement" | "quote"）で載せる。
 *  - statement の 1 文は `# 見出し`（本文は補足行）。
 *  - quote の帰属は `—`・`―`・`--` で始まる最終行を 2 つ目の本文枠（idx 2）へ。
 *  - 該当レイアウトが無いテンプレでは退化（statement → 従来の章扉／本文、quote → 本文）し、
 *    get_deck_issues に info `marker-layout-missing` を 1 件出す（never-silent）。
 * 受け入れ (a)(b)(e)。マーカー無しスライドの選択は 1 枚も変えない（layout-pick-corpus の snapshot が別途検査）。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate, autoSelectLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog, type LayoutCatalog } from "../src/engine/template-catalog";
import { slideBindingPlan, groupEditorPlan } from "../src/engine/group-binding";
import { resolveBinding } from "../src/engine/placeholder-binding";
import { isGroupedLayout } from "../src/engine/group-layout";
import { writeTemplate, MIDNIGHT_PALETTE } from "../src/engine/template-writer";
import { diagnoseDeck, REVIEW_RULES } from "../src/engine/deck-diagnostics";
import { serializeMd } from "../src/engine/md-serializer";
import { parseMd } from "../src/engine/md-parser";
import type { SlideIR, PlaceholderContent } from "../src/engine/slide-schema";

const MIDNIGHT = resolve(__dirname, "../samples/templates/Midnight_Executive_30_TemplateOnly.pptx");
const MAGAZINE = resolve(__dirname, "../public/templates/slide/ビジュアルデッキ_マガジン_TemplateOnly.pptx");
const TECH = resolve(__dirname, "../public/templates/slide/技術報告_スタンダード水色_TemplateOnly.pptx");
const KOBUNSHO = resolve(__dirname, "../public/templates/slide/配布資料_公文書高密度_TemplateOnly.pptx");

const COVER = "# 表紙\n\nサブタイトル\n\n---\n\n";
const STATEMENT = "<!-- statement -->\n# 必要な情報に、15 分かけていませんか。";
const STATEMENT_WITH_BODY = STATEMENT + "\n\n社内調査（n=120）より";
const QUOTE = "<!-- quote -->\n# お客様の声\n\n「過去提案が 1 回の質問で出てくる。」\n\n— パイロット部門 マネージャー";

const text = (c: PlaceholderContent | undefined) => c?.paragraphs.map((p) => p.segments.map((s) => s.text).join("")).join("\n");
const ph = (slide: SlideIR, idx: string) => text(slide.placeholders.find((p) => p.idx === idx));
const lastSlide = (md: string) => {
  const deck = parseMd(md);
  return { deck, slide: deck.slides[deck.slides.length - 1], n: deck.slides.length };
};
const pickLast = (md: string, catalog: LayoutCatalog) => {
  const { slide, n } = lastSlide(md);
  return autoSelectLayout(slide, n - 1, n, catalog);
};
/** Text bound to the layout placeholder named `phName`, via the SAME dispatch export/preview use. */
const boundByName = (slide: SlideIR, tpl: TemplateData, layoutName: string) => {
  const layout = tpl.layouts.find((l) => l.name === layoutName)!;
  const plan = slideBindingPlan(slide, layout);
  return (phName: string) => {
    const idx = layout.placeholders.find((p) => p.name === phName)!.idx;
    return text(plan.assignments.find((a) => a.placeholder.idx === idx)?.content.content);
  };
};
const generated = async () =>
  loadTemplate(await writeTemplate({ name: "Generated", fonts: { major: "Georgia", minor: "Calibri" }, palette: { ...MIDNIGHT_PALETTE } }));

// ── 解析 ──

describe("#593 解析: マーカー → groupKind", () => {
  it("statement: 1 文は # 見出し（idx 15）・本文は補足（idx 1）・マーカーは本文に残らない", () => {
    const { slide } = lastSlide(STATEMENT_WITH_BODY);
    expect(slide.groupKind).toBe("statement");
    expect(ph(slide, "15")).toBe("必要な情報に、15 分かけていませんか。");
    expect(ph(slide, "1")).toBe("社内調査（n=120）より");
    expect(JSON.stringify(slide)).not.toContain("statement -->");
  });

  it.each(["— 山田", "― 山田", "-- 山田"])("quote: 最終行 %s は帰属として idx 2 へ（引用文は idx 1）", (attr) => {
    const { slide } = lastSlide(`<!-- quote -->\n# 声\n\n「引用文」\n\n${attr}`);
    expect(slide.groupKind).toBe("quote");
    expect(ph(slide, "1")).toBe("「引用文」");
    expect(ph(slide, "2")).toBe(attr);
  });

  it("quote: 帰属行が段落区切り無しで続いても最終行なら帰属", () => {
    const { slide } = lastSlide("<!-- quote -->\n「引用文」\n— 山田");
    expect(ph(slide, "1")).toBe("「引用文」");
    expect(ph(slide, "2")).toBe("— 山田");
  });

  it("quote: 帰属行が無ければ本文だけ（idx 2 は作らない）・途中の — 行は帰属にしない", () => {
    const a = lastSlide("<!-- quote -->\n「引用文」").slide;
    expect(a.placeholders.map((p) => p.idx)).toEqual(["1"]);
    const b = lastSlide("<!-- quote -->\n— 先頭の行\n\n「引用文」").slide;
    expect(ph(b, "1")).toBe("— 先頭の行\n\n「引用文」"); // 空行は空段落として残る（既存の段落表現）
    expect(ph(b, "2")).toBeUndefined();
  });

  it("マーカー無しの同じ本文は従来どおり（groupKind 無し・帰属行も本文）", () => {
    const { slide } = lastSlide("# お客様の声\n\n「引用文」\n\n— 山田");
    expect(slide.groupKind).toBeUndefined();
    expect(ph(slide, "1")).toBe("「引用文」\n\n— 山田");
  });

  it("コードフェンス内のマーカー風の行はマーカーにしない", () => {
    const { slide } = lastSlide("# 例\n\n```html\n<!-- statement -->\n```");
    expect(slide.groupKind).toBeUndefined();
    expect(slide.code?.content).toBe("<!-- statement -->");
  });

  it("layout pin と併用できる（マーカーは pin の前後どちらでも）", () => {
    for (const md of ["<!-- slide: Content.1Body.Single -->\n<!-- statement -->\n# A", "<!-- statement -->\n<!-- slide: Content.1Body.Single -->\n# A"]) {
      const { slide } = lastSlide(md);
      expect(slide.layout).toBe("Content.1Body.Single");
      expect(slide.groupKind).toBe("statement");
    }
  });
});

// ── 往復（md → SlideIR → md）──

describe("#593 往復: シリアライザがマーカーを書き戻す（不動点）", () => {
  const DECKS = [COVER + STATEMENT, COVER + STATEMENT_WITH_BODY, COVER + QUOTE, COVER + "<!-- quote -->\n「引用文」\n\n― 山田"];
  const cases: Array<[string, () => Promise<TemplateData | undefined>]> = [
    ["テンプレ無し", async () => undefined],
    ["生成テンプレ", generated],
    ["Midnight（該当レイアウト無し）", async () => loadTemplate(readFileSync(MIDNIGHT))],
    ["マガジン", async () => loadTemplate(readFileSync(MAGAZINE))],
    ["技術報告（該当レイアウト無し・2 枠本文も無し）", async () => loadTemplate(readFileSync(TECH))],
    ["公文書（該当レイアウト無し）", async () => loadTemplate(readFileSync(KOBUNSHO))],
  ];
  for (const [label, load] of cases) {
    it(label, async () => {
      const tpl = await load();
      const st = tpl ? { catalog: buildCatalog(tpl), layouts: tpl.layouts } : undefined;
      for (const md of DECKS) {
        const once = serializeMd(parseMd(md), st);
        const twice = serializeMd(parseMd(once), st);
        expect(twice).toBe(once);
        const strip = (d: ReturnType<typeof parseMd>) => d.slides.map((sl) => ({ ...sl, sourceLineStart: 0, sourceLineEnd: 0 }));
        expect(strip(parseMd(once))).toEqual(strip(parseMd(md)));
        expect(once).toContain(md.includes("statement") ? "<!-- statement -->" : "<!-- quote -->");
      }
    });
  }
});

// ── (a)(b) 生成テンプレ ──

describe("#593 (a)(b) 生成テンプレ: マーカーで Statement / Quote に届く", () => {
  let tpl: TemplateData;
  let catalog: LayoutCatalog;
  beforeAll(async () => {
    tpl = await generated();
    catalog = buildCatalog(tpl);
  });

  it("(a) statement → Statement.1Message.Single・1 文が主枠・補足が下段", () => {
    expect(pickLast(COVER + STATEMENT, catalog)).toBe("Statement.1Message.Single");
    expect(pickLast(COVER + STATEMENT_WITH_BODY, catalog)).toBe("Statement.1Message.Single");
    const at = boundByName(lastSlide(COVER + STATEMENT_WITH_BODY).slide, tpl, "Statement.1Message.Single");
    expect(at("Message.Center")).toBe("必要な情報に、15 分かけていませんか。");
    expect(at("Supporting.Bottom")).toBe("社内調査（n=120）より");
  });

  it("(a) 先頭スライドでもマーカーが表紙判定より優先", () => {
    const deck = parseMd(STATEMENT);
    expect(autoSelectLayout(deck.slides[0], 0, 1, catalog)).toBe("Statement.1Message.Single");
  });

  it("(b) quote → Quote.1Message.Single+1Attribution・引用文が主枠・帰属が従枠", () => {
    expect(pickLast(COVER + QUOTE, catalog)).toBe("Quote.1Message.Single+1Attribution");
    const at = boundByName(lastSlide(COVER + QUOTE).slide, tpl, "Quote.1Message.Single+1Attribution");
    expect(at("Quote.Center")).toBe("「過去提案が 1 回の質問で出てくる。」");
    expect(at("Attribution.Bottom")).toBe("— パイロット部門 マネージャー");
    expect(at("SlideTitle.Header")).toBe("お客様の声");
  });

  it("layout pin がテンプレにあれば pin が勝つ", () => {
    expect(pickLast(COVER + "<!-- slide: Content.1Body.Single -->\n" + STATEMENT_WITH_BODY, catalog)).toBe("Content.1Body.Single");
  });

  it("Statement / Quote はグループ型レイアウトではない（expandGroups は動かず、通常の束縛で入る）", () => {
    for (const name of ["Statement.1Message.Single", "Quote.1Message.Single+1Attribution"]) {
      expect(isGroupedLayout(tpl.layouts.find((l) => l.name === name)!)).toBe(false);
    }
  });

  it("診断: 該当レイアウトがあるので marker-layout-missing は出ない", () => {
    const issues = diagnoseDeck(parseMd(COVER + STATEMENT + "\n\n---\n\n" + QUOTE), catalog, tpl.layouts);
    expect(issues.filter((i) => i.id === "marker-layout-missing")).toEqual([]);
  });
});

// ── グループ専用の束縛（expandGroups）は statement/quote では動かない ──

describe("#593 statement/quote はグループではない: グループ型レイアウトに pin しても通常の束縛", () => {
  it("quote を KPI.3Value.Equal（グループ型）に pin → slideBindingPlan は resolveBinding と同じ・エディタもグループ扱いしない", async () => {
    const tpl = await loadTemplate(readFileSync(MIDNIGHT));
    const layout = tpl.layouts.find((l) => l.name === "KPI.3Value.Equal")!;
    expect(isGroupedLayout(layout)).toBe(true);
    const { slide } = lastSlide(COVER + "<!-- slide: KPI.3Value.Equal -->\n" + QUOTE);
    expect(slide.groupKind).toBe("quote");
    expect(slideBindingPlan(slide, layout)).toEqual(resolveBinding(slide, layout.placeholders));
    expect(groupEditorPlan(slide, layout)).toBeNull();
  });
});

// ── (e) マガジン：名前ベース到達 ──

describe("#593 (e) マガジン: マーカー付きだけが 02_ステートメント／07_引用 に届く", () => {
  let tpl: TemplateData;
  let catalog: LayoutCatalog;
  beforeAll(async () => {
    tpl = await loadTemplate(readFileSync(MAGAZINE));
    catalog = buildCatalog(tpl);
  });

  it("statement → 02_ステートメント・1 文がタイトル枠・補足が本文枠", () => {
    expect(pickLast(COVER + STATEMENT_WITH_BODY, catalog)).toBe("02_ステートメント");
    const layout = tpl.layouts.find((l) => l.name === "02_ステートメント")!;
    const plan = slideBindingPlan(lastSlide(COVER + STATEMENT_WITH_BODY).slide, layout);
    const by = (idx: string) => text(plan.assignments.find((a) => a.placeholder.idx === idx)?.content.content);
    expect(by("0")).toBe("必要な情報に、15 分かけていませんか。");
    expect(by("1")).toBe("社内調査（n=120）より");
    expect(plan.unbound).toEqual([]);
  });

  it("quote → 07_引用・引用文が 1 つ目の本文枠・帰属が 2 つ目（キャプション）", () => {
    expect(pickLast(COVER + QUOTE, catalog)).toBe("07_引用");
    const layout = tpl.layouts.find((l) => l.name === "07_引用")!;
    const plan = slideBindingPlan(lastSlide(COVER + QUOTE).slide, layout);
    const bodies = layout.placeholders.filter((p) => p.type === "body").map((p) => p.idx);
    const by = (idx: string) => text(plan.assignments.find((a) => a.placeholder.idx === idx)?.content.content);
    expect(by(bodies[0])).toBe("「過去提案が 1 回の質問で出てくる。」");
    expect(by(bodies[1])).toBe("— パイロット部門 マネージャー");
    expect(plan.unbound).toEqual([]);
  });

  it("マーカー無しの同じ本文は 02_ステートメント／07_引用 に届かない", () => {
    expect(pickLast(COVER + "# 必要な情報に、15 分かけていませんか。", catalog)).not.toBe("02_ステートメント");
    expect(pickLast(COVER + "# 必要な情報に、15 分かけていませんか。\n\n社内調査より", catalog)).not.toBe("02_ステートメント");
    expect(pickLast(COVER + "# お客様の声\n\n「引用」\n\n— 山田", catalog)).not.toBe("07_引用");
  });
});

// ── 退化（該当レイアウトが無いテンプレ）＋ never-silent ──

describe("#593 退化: 該当レイアウトが無いテンプレ", () => {
  it("Midnight: statement は従来の章扉／本文、quote は本文（2 枠の本文レイアウト）へ・帰属も失わない", async () => {
    const tpl = await loadTemplate(readFileSync(MIDNIGHT));
    const catalog = buildCatalog(tpl);
    expect(pickLast(COVER + STATEMENT, catalog)).toBe(pickLast(COVER + "# 必要な情報に、15 分かけていませんか。", catalog));
    expect(pickLast(COVER + STATEMENT_WITH_BODY, catalog)).toBe(pickLast(COVER + "# 必要な情報に、15 分かけていませんか。\n\n社内調査（n=120）より", catalog));
    const q = pickLast(COVER + QUOTE, catalog);
    expect(catalog.find((e) => e.name === q)?.role).toBe("content");
    const plan = slideBindingPlan(lastSlide(COVER + QUOTE).slide, tpl.layouts.find((l) => l.name === q)!);
    expect(plan.unbound).toEqual([]);
  });

  it("2 枠の本文レイアウトも無いテンプレ（技術報告）: quote は従来の選択（2 カラム）へ・グループ型には落とさない・帰属は失わない", async () => {
    const tpl = await loadTemplate(readFileSync(TECH));
    const catalog = buildCatalog(tpl);
    const q = pickLast(COVER + QUOTE, catalog);
    expect(q).toBe("03_本文（2カラム）");
    expect(catalog.find((e) => e.name === q)?.groupKind).toBeUndefined();
    const plan = slideBindingPlan(lastSlide(COVER + QUOTE).slide, tpl.layouts.find((l) => l.name === q)!);
    expect(plan.unbound).toEqual([]);
  });

  it("診断: info marker-layout-missing をマーカー付きスライドに 1 件ずつ（REVIEW_RULES 登録済み）", async () => {
    expect(REVIEW_RULES).toContainEqual({ id: "marker-layout-missing", level: "info" });
    const tpl = await loadTemplate(readFileSync(MIDNIGHT));
    const deck = parseMd(COVER + STATEMENT + "\n\n---\n\n" + QUOTE + "\n\n---\n\n# 普通\n\n- 本文");
    const hits = diagnoseDeck(deck, buildCatalog(tpl), tpl.layouts).filter((i) => i.id === "marker-layout-missing");
    expect(hits.map((h) => [h.slideIndex, h.level])).toEqual([[1, "info"], [2, "info"]]);
    expect(hits[0].message).toContain("statement");
    expect(hits[1].message).toContain("quote");
  });

  it("診断: pin がテンプレにあるスライド（マーカーが選択に効かない）には出さない", async () => {
    const tpl = await loadTemplate(readFileSync(MIDNIGHT));
    const deck = parseMd(COVER + "<!-- slide: Content.1Body.Single -->\n" + STATEMENT_WITH_BODY);
    expect(diagnoseDeck(deck, buildCatalog(tpl), tpl.layouts).filter((i) => i.id === "marker-layout-missing")).toEqual([]);
  });
});
