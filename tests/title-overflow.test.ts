/**
 * title-overflow.test.ts — Issue #437 案a: タイトルが解決レイアウトのタイトル枠に収まらないとき、
 * warn `title-overflow`（condense レバー）を出す。診断のみ — レンダリング（プレビュー/PPTX）は
 * 一切変えない。見積りは body 容量と同じ placeholderFitBox（catalog の charsPerLine/maxLines）＋
 * paragraphLines を再利用する（R8: 第 2 の容量計算を作らない）。
 *
 * repro（Issue 実測）: Midnight の Content 系タイトル枠は全角約 25-28 字で右端切断。案 b
 * （フォント縮小の焼き込み）は PowerPoint 実機確認待ちで、ここでは実装しない。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog, type LayoutCatalog } from "../src/engine/template-catalog";
import { parseMd } from "../src/engine/md-parser";
import { diagnoseDeck, REVIEW_RULES } from "../src/engine/deck-diagnostics";

const MIDNIGHT = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");

// Issue #437 repro の性能試験デッキ slide 5 のタイトル（全角換算 47 字 > Content 系の約 25 字/行）。
const LONG_TITLE = "Citrix NetScaler ―― 9 月に 2 度の KEV 登録、Web シェルで常駐";

/** 表紙 + 対象スライド + 末尾スライドの 3 枚デッキ（表紙 coercion / closing 判定の影響を避ける）。 */
const deckMd = (title: string) => `# 表紙\n\n## サブ\n\n---\n\n# ${title}\n\n- 速度: 0.8秒\n- 重量: 1.2kg\n\n---\n\n# 短い結び\n\n- a`;

describe("diagnoseDeck — title-overflow (#437 案a)", () => {
  let tpl: TemplateData;
  let catalog: LayoutCatalog;
  beforeAll(async () => {
    tpl = await loadTemplate(readFileSync(MIDNIGHT));
    catalog = buildCatalog(tpl);
  });
  const overflows = (md: string) => diagnoseDeck(parseMd(md), catalog, tpl.layouts).filter((i) => i.id === "title-overflow");

  it("長タイトル + Midnight → 対象スライドに warn が 1 件（condense レバー・レイアウト名入り）", () => {
    const issues = overflows(deckMd(LONG_TITLE));
    expect(issues).toHaveLength(1);
    expect(issues[0].slideIndex).toBe(1);
    expect(issues[0].title).toBe(LONG_TITLE);
    expect(issues[0].level).toBe("warn");
    expect(issues[0].level).toBe(REVIEW_RULES.find((r) => r.id === "title-overflow")!.level);
    expect(issues[0].levers).toEqual(["condense"]);
    expect(issues[0].message).toContain("タイトル");
  });

  // ── 負側：収まるタイトルは 0 件・既存経路は不変 ──
  it("短いタイトル → 0 件（デッキ全体でも診断ゼロ）", () => {
    expect(diagnoseDeck(parseMd(deckMd("短いタイトル")), catalog, tpl.layouts)).toEqual([]);
  });

  it("見積りちょうど（全角 25 字 = Content 系 charsPerLine）→ 0 件、26 字 → 1 件", () => {
    expect(overflows(deckMd("あ".repeat(25)))).toEqual([]);
    expect(overflows(deckMd("あ".repeat(26)))).toHaveLength(1);
  });

  it("2 引数 diagnoseDeck（テンプレ未ロード）は byte-identical — refine の収束判定を変えない", () => {
    expect(diagnoseDeck(parseMd(deckMd(LONG_TITLE)), catalog).filter((i) => i.id === "title-overflow")).toEqual([]);
  });
});
