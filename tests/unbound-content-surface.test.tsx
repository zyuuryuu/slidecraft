/**
 * unbound-content-surface.test.tsx — Issue #97: 未束縛 content（どの枠にも入らず出力時に消える内容）を
 * 診断と取り込み結果バー（IntakeSummaryBar）に出す（master-intake.md §2 部品2・P1 可視性不変条件）。
 *
 * 診断（diagnoseDeck の 3 引数経路）・MCP（get_deck_issues）・ReviewBar への配線は #419 で済んでいる。
 * この Issue で固定するのは次の 2 点：
 *  1. 汎用の unbound-content メッセージが「件数」に加えて「どの内容か（先頭テキスト）」を名指す
 *     （件数だけでは、どの行が消えるのか作者に分からない）。
 *  2. 取り込み結果バーが、適用したテンプレで現在のデッキに未束縛が出ることを強警告で示す。
 *     バーは診断の出力をそのまま受け取る（検出経路を増やさない＝R8 の二重計算を作らない）。
 *
 * fixture: Midnight テンプレの `Compare.1Matrix.Single` は title 枠のみ（本文枠なし）。ここへ本文つき
 * スライドを固定すると本文が未束縛になる。`Content.1Body.Single` なら全部束縛される（対照）。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { renderToStaticMarkup } from "react-dom/server";
import "../src/i18n"; // init side-effect → useTranslation interpolates (ja default)
import IntakeSummaryBar, { Detail, type IntakeResult } from "../src/components/IntakeSummaryBar";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog, type LayoutCatalog } from "../src/engine/template-catalog";
import { parseMd } from "../src/engine/md-parser";
import { diagnoseDeck, type DeckIssue } from "../src/engine/deck-diagnostics";
import type { DeckIR, SlideIR } from "../src/engine/slide-schema";

const MIDNIGHT = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");
const NO_BODY_LAYOUT = "Compare.1Matrix.Single"; // title 枠のみ
const ONE_BODY_LAYOUT = "Content.1Body.Single";

/** index-0 の表紙 coercion を避けるため、対象スライドを 3 枚デッキの中央に置く（field-rows.test と同じ）。 */
const asMiddle = (s: SlideIR): DeckIR => ({ slides: [{ layout: "auto", placeholders: [] }, s, { layout: "auto", placeholders: [] }] });
const pinned = (md: string, layout: string): DeckIR => asMiddle({ ...parseMd(md).slides[0], layout });
const unbound = (issues: DeckIssue[]) => issues.filter((i) => i.id === "unbound-content");

const result: IntakeResult = { mode: "import", name: "Midnight", ts: 0, summary: { layoutCount: 30, status: "ok", findings: [] } };

describe("#97 診断: 未束縛 content を件数と内容の先頭で名指す", () => {
  let tpl: TemplateData;
  let catalog: LayoutCatalog;
  beforeAll(async () => {
    tpl = await loadTemplate(new Uint8Array(readFileSync(MIDNIGHT)));
    catalog = buildCatalog(tpl);
  });

  it("本文枠の無いレイアウト → unbound-content が 1 件・件数と本文の先頭テキストを含む", () => {
    const issues = unbound(diagnoseDeck(pinned("# 見出し\n\n- 消える本文その一\n- 二", NO_BODY_LAYOUT), catalog, tpl.layouts));
    expect(issues).toHaveLength(1);
    expect(issues[0].slideIndex).toBe(1);
    expect(issues[0].level).toBe("warn");
    expect(issues[0].message).toContain("内容 1 件");
    expect(issues[0].message).toContain("「消える本文その一」");
    expect(issues[0].message).toContain(NO_BODY_LAYOUT);
  });

  it("長い先頭テキストは省略記号つきで切り詰める（メッセージが 1 行に収まる）", () => {
    const long = "あ".repeat(60);
    const [issue] = unbound(diagnoseDeck(pinned(`# 見出し\n\n- ${long}`, NO_BODY_LAYOUT), catalog, tpl.layouts));
    expect(issue.message).toContain(`「${"あ".repeat(20)}…」`);
    expect(issue.message).not.toContain("あ".repeat(21));
  });

  it("全 content が束縛されるデッキ → unbound-content は出ない", () => {
    expect(unbound(diagnoseDeck(pinned("# 見出し\n\n- 入る本文", ONE_BODY_LAYOUT), catalog, tpl.layouts))).toEqual([]);
  });
});

describe("#97 取り込み結果バー: 未束縛を強警告で出す", () => {
  const issue: DeckIssue = {
    slideIndex: 1,
    title: "見出し",
    id: "unbound-content",
    level: "warn",
    message: "内容 1 件（先頭「消える本文その一」）がこのレイアウト（Compare.1Matrix.Single）に入りません（未束縛・出力時に消えます）",
    levers: [],
  };

  it("未束縛がある → 要約行に強警告（件数＝該当スライド数）が出る", () => {
    const html = renderToStaticMarkup(<IntakeSummaryBar busy={null} result={result} onDismiss={() => {}} unbound={[issue]} />);
    expect(html).toContain("未束縛の内容があるスライド 1 枚");
    expect(html).toContain('data-testid="intake-unbound"');
  });

  it("同じスライドに 2 件（フィールド行＋本文）→ スライド数は 1 枚と数える", () => {
    const html = renderToStaticMarkup(<IntakeSummaryBar busy={null} result={result} onDismiss={() => {}} unbound={[issue, { ...issue, message: "Takeaway: 行の置き場…" }]} />);
    expect(html).toContain("未束縛の内容があるスライド 1 枚");
  });

  it("詳細に各スライドの番号（1 始まり）と診断メッセージを列挙する", () => {
    const html = renderToStaticMarkup(<Detail result={result} unbound={[issue]} />);
    expect(html).toContain("スライド 2");
    expect(html).toContain("「消える本文その一」");
  });

  it("未束縛が無い（空配列・未指定）→ 警告は出ない（従来の表示のまま）", () => {
    for (const u of [[], undefined]) {
      const html = renderToStaticMarkup(<IntakeSummaryBar busy={null} result={result} onDismiss={() => {}} unbound={u} />);
      expect(html).not.toContain("intake-unbound");
      expect(html).not.toContain("未束縛");
    }
  });
});
