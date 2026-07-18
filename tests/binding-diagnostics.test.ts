/**
 * binding-diagnostics.test.ts — ADR-0030 stage A acceptance: `diagnoseDeck` (and get_deck_issues via
 * the session) now SURFACES content the resolved layout cannot hold, instead of dropping it silently
 * (#97 ②a surface, #135 / #128 go from 無言 → 警告付き). The wrapper is pure observation, so:
 *   1. a 4-group kpi deck on the default create_template template warns (#135),
 *   2. the adversarial cover's subtitle warns (#128),
 *   3. a HEALTHY deck gains NOT ONE new diagnostic (the byte-identical invariant), and
 *   4. resolveBinding's assignments == bindContentByRole → export input (thus bytes) is unchanged.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate, autoSelectLayout, findLayout, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";
import { parseMd } from "../src/engine/md-parser";
import { distillDeck } from "../src/engine/distill";
import { diagnoseDeck } from "../src/engine/deck-diagnostics";
import { bindContentByRole, resolveBinding } from "../src/engine/placeholder-binding";
import { writeTemplate } from "../src/engine/template-writer";
import { parseTemplateSpecResponse } from "../src/engine/template-spec-prompts";
import * as S from "../src/mcp/session";

const DIRTY = resolve(__dirname, "fixtures/templates/Dirty_Adversarial_TemplateOnly.pptx");
const MIDNIGHT = resolve(__dirname, "fixtures/templates/Midnight_Executive_30_TemplateOnly.pptx");
const REPORT = resolve(__dirname, "fixtures/templates/報告書テンプレート_全レイアウト見本.pptx");
const ALIEN = resolve(__dirname, "fixtures/templates/lrk-slides-velis_CC0.pptx");

const KPI_MD = `# 主要指標

<!-- kpi -->
### 売上
- 14.8億

<!-- kpi -->
### 利益
- 3.6億

<!-- kpi -->
### 粗利率
- 31.5%

<!-- kpi -->
### 解約率
- 5.2%`;

// A deck whose every content binds on any healthy template (cover + a 2-bullet content slide, NO
// closing slide — a ctrTitle closing would legitimately drop a body, which is a different case).
const HEALTHY_MD = "# 表紙\n\n## サブ\n\n---\n\n# 中身\n\n- 速度: 0.8秒\n- 重量: 1.2kg";

const isUnbound = (m: string) => m.includes("未束縛");

async function defaultTemplateBytes(): Promise<Uint8Array> {
  const spec = parseTemplateSpecResponse("{}");
  if (!spec.ok) throw new Error("default spec parse failed");
  return writeTemplate(spec.spec);
}

describe("diagnoseDeck binding-surface — #135 4-group kpi drop", () => {
  it("get_deck_issues (getDiagnostics) warns that the 4th group is unbound", async () => {
    const s = S.createSession(null);
    await S.newProject(s, await defaultTemplateBytes(), KPI_MD);
    const { issues } = S.getDiagnostics(s);
    expect(issues.some((x) => x.level === "warn" && isUnbound(x.message))).toBe(true);
  });

  it("new_project's OWN returned diagnostics surface it too (the new_project → edit loop has no blind spot)", async () => {
    const s = S.createSession(null);
    const r = await S.newProject(s, await defaultTemplateBytes(), KPI_MD);
    expect(r.diagnostics.some((x) => x.level === "warn" && isUnbound(x.message))).toBe(true);
  });

  it("diagnoseDeck(deck, catalog, layouts) surfaces it; without layouts it stays silent", async () => {
    const tpl = await loadTemplate(await defaultTemplateBytes());
    const catalog = buildCatalog(tpl);
    const deck = distillDeck(parseMd(KPI_MD), catalog);
    expect(diagnoseDeck(deck, catalog).some((x) => isUnbound(x.message))).toBe(false); // 2-arg = byte-identical
    expect(diagnoseDeck(deck, catalog, tpl.layouts).some((x) => isUnbound(x.message))).toBe(true);
  });
});

describe("diagnoseDeck binding-surface — #128 adversarial cover subtitle drop", () => {
  it("warns that the cover's subtitle content is unbound (silent-drop today)", async () => {
    const tpl = await loadTemplate(readFileSync(DIRTY));
    const catalog = buildCatalog(tpl);
    const deck = distillDeck(parseMd("# タイトル\n\n## サブタイトル"), catalog);
    const issues = diagnoseDeck(deck, catalog, tpl.layouts);
    expect(issues.some((x) => x.slideIndex === 0 && x.level === "warn" && isUnbound(x.message))).toBe(true);
  });
});

describe("diagnoseDeck binding-surface — healthy decks gain NO new diagnostics", () => {
  const templates: Array<[string, string]> = [
    ["Midnight", MIDNIGHT],
    ["Report", REPORT],
    ["Alien velis", ALIEN],
  ];
  for (const [label, path] of templates) {
    it(`${label}: layouts-aware diagnose == plain diagnose (no added issue)`, async () => {
      const tpl = await loadTemplate(readFileSync(path));
      const catalog = buildCatalog(tpl);
      const deck = distillDeck(parseMd(HEALTHY_MD), catalog);
      const plain = diagnoseDeck(deck, catalog);
      const withLayouts = diagnoseDeck(deck, catalog, tpl.layouts);
      expect(withLayouts.length).toBe(plain.length);
      expect(withLayouts.some((x) => isUnbound(x.message))).toBe(false);
    });
  }
});

describe("resolveBinding is pure observation — export input (bytes) unchanged", () => {
  it("assignments reconstruct bindContentByRole across templates (healthy deck)", async () => {
    for (const path of [MIDNIGHT, REPORT, ALIEN]) {
      const tpl: TemplateData = await loadTemplate(readFileSync(path));
      const catalog = buildCatalog(tpl);
      const deck = distillDeck(parseMd(HEALTHY_MD), catalog);
      deck.slides.forEach((slide, i) => {
        const layout = findLayout(tpl, autoSelectLayout(slide, i, deck.slides.length, catalog))!;
        if (slide.groupKind) return; // grouped path covered by slideBindingPlan tests
        const bound = bindContentByRole(slide, layout.placeholders);
        const reconstructed = new Map(resolveBinding(slide, layout.placeholders).assignments.map((a) => [a.placeholder.idx, a.content.content]));
        expect(new Set(reconstructed.keys())).toEqual(new Set(bound.keys()));
        for (const [idx, content] of bound) expect(reconstructed.get(idx)).toBe(content);
      });
    }
  });
});
