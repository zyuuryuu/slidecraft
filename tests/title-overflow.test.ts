/**
 * title-overflow.test.ts — Issue #437: タイトルが解決レイアウトのタイトル枠に収まらないとき、
 * warn `title-overflow`（condense レバー）を出す。
 *
 * 案b（2026-11-06 ユーザ合意）以降、溢れるタイトルは export / preview が title-fit の fitTitle で
 * 枠に収まるまで縮小する（下限 = 元サイズ × TITLE_MIN_SCALE）。warn は「下限まで縮めても収まらない」
 * ときだけ出す（never-silent）。判定は縮小と同じ fitTitle を読む（R8: tests/title-fit.test.ts）。
 *
 * repro（Issue 実測）: Midnight の Content 系タイトル枠（10.0×0.52in・28pt）。下限 20pt での
 * 見積り幅は全角 35 字まで。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog, type LayoutCatalog } from "../src/engine/template-catalog";
import { parseMd } from "../src/engine/md-parser";
import { diagnoseDeck, REVIEW_RULES } from "../src/engine/deck-diagnostics";

const MIDNIGHT = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");

// Issue #437 repro の性能試験デッキ slide 5 のタイトル（28pt では溢れ、縮小で収まる）。
const LONG_TITLE = "Citrix NetScaler ―― 9 月に 2 度の KEV 登録、Web シェルで常駐";
// 下限 20pt でも収まらない長さ（全角 60 字 > 35 字）。
const HUGE_TITLE = "あ".repeat(60);

/** 表紙 + 対象スライド + 末尾スライドの 3 枚デッキ（表紙 coercion / closing 判定の影響を避ける）。 */
const deckMd = (title: string) => `# 表紙\n\n## サブ\n\n---\n\n# ${title}\n\n- 速度: 0.8秒\n- 重量: 1.2kg\n\n---\n\n# 短い結び\n\n- a`;

describe("diagnoseDeck — title-overflow (#437)", () => {
  let tpl: TemplateData;
  let catalog: LayoutCatalog;
  beforeAll(async () => {
    tpl = await loadTemplate(readFileSync(MIDNIGHT));
    catalog = buildCatalog(tpl);
  });
  const overflows = (md: string) => diagnoseDeck(parseMd(md), catalog, tpl.layouts).filter((i) => i.id === "title-overflow");

  it("下限でも収まらないタイトル + Midnight → 対象スライドに warn が 1 件（condense レバー・レイアウト名入り）", () => {
    const issues = overflows(deckMd(HUGE_TITLE));
    expect(issues).toHaveLength(1);
    expect(issues[0].slideIndex).toBe(1);
    expect(issues[0].title).toBe(HUGE_TITLE);
    expect(issues[0].level).toBe("warn");
    expect(issues[0].level).toBe(REVIEW_RULES.find((r) => r.id === "title-overflow")!.level);
    expect(issues[0].levers).toEqual(["condense"]);
    expect(issues[0].message).toContain("タイトル");
    expect(issues[0].message).toContain("Content.1Body.Single");
  });

  it("縮小で収まる長タイトル（Issue repro）→ 0 件（export / preview が縮小する）", () => {
    expect(overflows(deckMd(LONG_TITLE))).toEqual([]);
  });

  // ── 負側：収まるタイトルは 0 件・既存経路は不変 ──
  it("短いタイトル → 0 件（デッキ全体でも診断ゼロ）", () => {
    expect(diagnoseDeck(parseMd(deckMd("短いタイトル")), catalog, tpl.layouts)).toEqual([]);
  });

  it("見積り境界（下限 20pt で全角 35 字）→ 35 字 0 件、36 字 → 1 件。旧境界 26 字は縮小で 0 件", () => {
    expect(overflows(deckMd("あ".repeat(26)))).toEqual([]);
    expect(overflows(deckMd("あ".repeat(35)))).toEqual([]);
    expect(overflows(deckMd("あ".repeat(36)))).toHaveLength(1);
  });

  it("2 引数 diagnoseDeck（テンプレ未ロード）は byte-identical — refine の収束判定を変えない", () => {
    expect(diagnoseDeck(parseMd(deckMd(HUGE_TITLE)), catalog).filter((i) => i.id === "title-overflow")).toEqual([]);
  });
});
