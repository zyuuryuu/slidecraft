/**
 * review-rules-agreement.test.ts — Issue #244: get_authoring_guide's `activeReviewRules` and the
 * DeckIssue.id/level that get_deck_issues actually emits must come from the SAME registry
 * (REVIEW_RULES in src/engine/deck-diagnostics.ts). Locks R8 (no 2nd definition of rule semantics):
 * the guide is a literal projection of REVIEW_RULES, and every issue diagnoseDeck /
 * parseNoticesToIssues produces carries an id+level pair that is IN that registry, unchanged.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import * as S from "../src/mcp/session";
import * as G from "../src/mcp/guides";
import { diagnoseDeck, parseNoticesToIssues, REVIEW_RULES } from "../src/engine/deck-diagnostics";
import { parseMd } from "../src/engine/md-parser";
import { loadTemplate } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";

let templateBytes: Buffer;
beforeAll(() => {
  templateBytes = readFileSync(resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx"));
});

describe("get_authoring_guide — activeReviewRules (#244)", () => {
  it("returns [{id, level}] as a literal projection of the engine's REVIEW_RULES (single source)", async () => {
    const s = S.createSession(null);
    await S.newProject(s, templateBytes);
    const g = G.getAuthoringGuide(s);
    expect(Array.isArray(g.activeReviewRules)).toBe(true);
    expect(g.activeReviewRules.length).toBeGreaterThan(0);
    expect(g.activeReviewRules).toEqual(REVIEW_RULES);
    for (const r of g.activeReviewRules) {
      expect(typeof r.id).toBe("string");
      expect(r.id.length).toBeGreaterThan(0);
      expect(["warn", "info"]).toContain(r.level);
    }
  });

  it("still requires an open project (never-silent), same as the rest of the guide", () => {
    expect(() => G.getAuthoringGuide(S.createSession(null))).toThrow(/開かれていません/);
  });
});

describe("REVIEW_RULES agreement — every real DeckIssue.id/level is IN the registry (#244)", () => {
  const registryLevel = new Map(REVIEW_RULES.map((r) => [r.id, r.level]));

  it("diagnoseDeck's content-level issues (title/touten/kuten/meta-key/long-bullet/key-value)", () => {
    const md = [
      "- 箇条書きのみ（タイトル無し）",
      "# 概要\n\n- 速く、安く、簡単に導入できる",
      "# 概要\n\n- 導入は容易です。",
      "# T\n\nMeta: 補足情報です",
      "# 長文\n\n- これは非常に長い文章のままの箇条書きで、キーフレーズになっておらず読みにくい悪い例です",
      "# 指標\n\n- 速度: 0.8秒\n- 重量: 1.2kg\n- 料金: 1200円",
    ].join("\n\n---\n\n");
    const issues = diagnoseDeck(parseMd(md));
    expect(issues.length).toBeGreaterThan(0);
    for (const iss of issues) {
      expect(iss.id).toBeDefined();
      expect(registryLevel.has(iss.id!)).toBe(true);
      expect(registryLevel.get(iss.id!)).toBe(iss.level);
    }
    // sanity: every rule id we deliberately triggered above actually showed up
    const seen = new Set(issues.map((i) => i.id));
    for (const id of ["missing-title", "touten-used", "kuten-used", "unrecognized-meta-key", "long-bullet", "key-value-table"]) {
      expect(seen.has(id as (typeof REVIEW_RULES)[number]["id"])).toBe(true);
    }
  });

  it("diagnoseDeck's template-scoped issues (body-overflow, unbound-content)", async () => {
    const tpl = await loadTemplate(templateBytes);
    const catalog = buildCatalog(tpl);
    const bullets = Array.from({ length: 30 }, (_, i) => `- 項目${i} の説明テキストをそれなりの長さで書く`).join("\n");
    const issues = diagnoseDeck(parseMd(`# 詰め込み\n\n${bullets}`), catalog, tpl.layouts);
    expect(issues.length).toBeGreaterThan(0);
    for (const iss of issues) {
      expect(iss.id).toBeDefined();
      expect(registryLevel.has(iss.id!)).toBe(true);
      expect(registryLevel.get(iss.id!)).toBe(iss.level);
    }
    expect(issues.some((i) => i.id === "body-overflow")).toBe(true);
  });

  it("parseNoticesToIssues' notice-derived issues (table/image/meta-key dropped)", () => {
    const deck = parseMd("# T\n\n- a");
    const issues = parseNoticesToIssues(deck, [
      { kind: "table-dropped", slideIndex: 0 },
      { kind: "image-dropped", slideIndex: 0 },
      { kind: "meta-key-dropped", slideIndex: 0, detail: "Meta" },
    ]);
    expect(issues).toHaveLength(3);
    for (const iss of issues) {
      expect(iss.id).toBeDefined();
      expect(registryLevel.has(iss.id!)).toBe(true);
      expect(registryLevel.get(iss.id!)).toBe(iss.level);
    }
  });
});
