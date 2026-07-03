/**
 * group-detect.test.ts — S1 of the grouped-layout path (docs/design/grouped-layout-binding.md).
 * detectGroups(layout) analyzes a layout's body/pic placeholders GEOMETRICALLY (x-cluster columns,
 * y-slot stack) and returns { kind, groups: GroupSlot[][] } or null for a non-grouped layout. It must
 * NOT go through placeholderRole/slideIdxRole (so idx15/16 group body cells aren't mis-typed), and it
 * must survive the real template variance: m4's full-width chrome number, m9's duplicate-idx page-meta
 * pollution, m1's picture-per-group card.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { loadTemplate, type TemplateData, type LayoutInfo } from "../src/engine/template-loader";
import { detectGroups } from "../src/engine/group-binding";

const DIR = resolve(__dirname, "../public/templates/slide");
const load = (f: string) => loadTemplate(readFileSync(resolve(DIR, f)));
const find = (t: TemplateData, re: RegExp): LayoutInfo | undefined => t.layouts.find((l) => re.test(l.name));
const roles = (shape: NonNullable<ReturnType<typeof detectGroups>>, col = 0) => shape.groups[col].map((s) => s.role);

describe("detectGroups — report family (報告書テンプレート_全レイアウト見本)", () => {
  let tpl: TemplateData;
  beforeAll(async () => { tpl = await load("報告書テンプレート_全レイアウト見本.pptx"); });

  it("10_カード3列 → card, 3 groups, [chrome, heading, body]", () => {
    const s = detectGroups(find(tpl, /^10_カード/)!)!;
    expect(s).toBeTruthy();
    expect(s.kind).toBe("card");
    expect(s.groups.length).toBe(3);
    expect(roles(s)).toEqual(["chrome", "heading", "body"]);
  });

  it("11_プロセス → step, 4 groups, [chrome, heading, body]", () => {
    const s = detectGroups(find(tpl, /プロセス/)!)!;
    expect(s.kind).toBe("step");
    expect(s.groups.length).toBe(4);
    expect(roles(s)).toEqual(["chrome", "heading", "body"]);
  });

  it("09_KPIハイライト → kpi, 3 groups, [heading, body, body] (no chrome — KPIラベル is the heading)", () => {
    const s = detectGroups(find(tpl, /KPI/)!)!;
    expect(s.kind).toBe("kpi");
    expect(s.groups.length).toBe(3);
    expect(roles(s)).toEqual(["heading", "body", "body"]);
  });

  it("12_課題と対策 → compare, 2 groups, [heading, body] (baked 見出し is not chrome)", () => {
    const s = detectGroups(find(tpl, /課題/)!)!;
    expect(s.kind).toBe("compare");
    expect(s.groups.length).toBe(2);
    expect(roles(s)).toEqual(["heading", "body"]);
  });

  it("a plain content layout is NOT grouped → null", () => {
    expect(detectGroups(find(tpl, /02_本文（1カラム）/)!)).toBeNull();
  });
});

describe("detectGroups — real template variance", () => {
  it("m4 (マガジン_生成りコーラル): the FULL-WIDTH card number is still detected as chrome (not width-based)", async () => {
    const tpl = await load("報告書テンプレート_マガジン_生成りコーラル_全レイアウト見本.pptx");
    const s = detectGroups(find(tpl, /^10_カード/)!)!;
    expect(s).toBeTruthy();
    expect(s.groups[0][0].role).toBe("chrome");
  });

  it("m9 (配布資料_公文書高密度): compare survives idx-dup page-meta pollution → 2 groups, not null", async () => {
    const tpl = await load("配布資料_公文書高密度_全レイアウト見本.pptx");
    const s = detectGroups(find(tpl, /課題|論点/)!)!;
    expect(s).toBeTruthy();
    expect(s.groups.length).toBe(2); // 出典/資料名スロット excluded
  });

  it("m1 (ビジュアルデッキ_マガジン): a picture-per-group card has a picture slot", async () => {
    const tpl = await load("ビジュアルデッキ_マガジン_全レイアウト見本.pptx");
    const layout = find(tpl, /画像|カード/);
    if (!layout) return; // template may name it differently
    const s = detectGroups(layout);
    if (s) expect(s.groups.some((g) => g.some((slot) => slot.role === "picture"))).toBe(true);
  });
});

// Adversarial regressions (grouped-feature verification, task wicr5yp5h): the confirmed detectGroups
// defects. (1)(2) chrome must be found by baked/name on ANY top-band slot, not only i===0 — in the
// 公文書 masters the number badge sorts BELOW its heading, so an i===0-only gate mis-classifies card→kpi.
// (3) the uniform gate must require columns' role SEQUENCES to agree, else the asymmetric SectionNav
// divider (col0=[chrome,heading] vs col1=[heading,body]) false-positives as a 2-group card.
describe("detectGroups — chrome position independence (公文書 number-below-heading cards)", () => {
  const roleSet = (shape: NonNullable<ReturnType<typeof detectGroups>>, col = 0) =>
    [...shape.groups[col].map((s) => s.role)].sort();

  it("報告書_公文書_白紺 10_カード3列 → card (番号 y=1.46 sorts below 見出し y=1.40, still chrome)", async () => {
    const tpl = await load("報告書テンプレート_公文書_白紺_全レイアウト見本.pptx");
    const s = detectGroups(find(tpl, /^10_カード/)!)!;
    expect(s).toBeTruthy();
    expect(s.kind).toBe("card"); // was mis-detected as 'kpi'
    expect(s.groups.length).toBe(3);
    expect(roleSet(s)).toEqual(["body", "chrome", "heading"]); // order [heading, chrome, body] by y
    expect(roles(s)).toEqual(["heading", "chrome", "body"]);
  });

  it("配布資料_公文書高密度 10_カード3列 → card (same number-below-heading geometry)", async () => {
    const tpl = await load("配布資料_公文書高密度_全レイアウト見本.pptx");
    const s = detectGroups(find(tpl, /^10_カード/)!)!;
    expect(s).toBeTruthy();
    expect(s.kind).toBe("card");
    expect(s.groups.length).toBe(3);
    expect(roleSet(s)).toEqual(["body", "chrome", "heading"]);
  });

  it("公文書_白紺 09_KPI stays kpi (数値 sits mid-column, outside the chrome top-band)", async () => {
    const tpl = await load("報告書テンプレート_公文書_白紺_全レイアウト見本.pptx");
    const s = detectGroups(find(tpl, /KPI/)!)!;
    expect(s.kind).toBe("kpi"); // must NOT flip to card via a mid-column value box
    expect(roles(s)).toEqual(["heading", "body", "body"]);
  });
});

describe("detectGroups — role-sequence uniform gate (reject asymmetric divider layouts)", () => {
  it("Midnight SectionNav.1Title.Single → null (col0=[chrome,heading] ≠ col1=[heading,body])", async () => {
    const tpl = await load("Midnight_Executive_30_Template.pptx");
    const l = find(tpl, /SectionNav/)!;
    expect(l).toBeTruthy();
    expect(detectGroups(l)).toBeNull(); // was a false-positive card, 2 groups
  });

  it("report 10_カード still passes the gate (all 3 columns share one role sequence)", async () => {
    const tpl = await load("報告書テンプレート_全レイアウト見本.pptx");
    const s = detectGroups(find(tpl, /^10_カード/)!)!;
    expect(s).toBeTruthy();
    const sig = (c: number) => s.groups[c].map((x) => x.role).join("|");
    expect(sig(0)).toBe(sig(1));
    expect(sig(1)).toBe(sig(2));
  });
});
