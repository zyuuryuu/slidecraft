/**
 * kpi-value-overflow-643.test.ts — #643: KPI の値（大数字）が値の枠に 1 行で収まらないのに get_deck_issues が
 * 何も出さなかった。新ルール `kpi-value-overflow`（warn・lever condense）で知らせる。
 *
 *  - 値の枠＝group-layout の kpiValueSlot（markKpiValue と同じ判定・R8）。値の段落は束縛（expandGroups）が
 *    実際にその枠へ置いた段落（slideBindingPlan の assignments を読む・R8）。
 *  - 1 行幅の見積りは title-fit と同じ measureLines（draw-target の wrapToWidth・枠の内側 0.1in・R8）。
 *  - 収まる値・KPI 以外のグループ（card 等）では 0 件。
 *  - 同梱コーパス（samples × 同梱テンプレ／プリセット／見本 fixture）での発火は、LibreOffice で実際に折り返しを
 *    確認した 1 件（生成りコーラルの 09_KPIハイライト 72pt に「4.2 億円」）だけ。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { parseMd } from "../src/engine/md-parser";
import { loadTemplate, type TemplateData } from "../src/engine/template-loader";
import { buildCatalog } from "../src/engine/template-catalog";
import { diagnoseDeck, REVIEW_RULES, type DeckIssue } from "../src/engine/deck-diagnostics";
import { writePresetTemplate, REPORT_PRESET, EXECUTIVE_PRESET, PITCH_PRESET } from "../src/engine/template-presets";
import * as S from "../src/mcp/session";

const ROOT = resolve(__dirname, "..");
const PUBLIC = resolve(ROOT, "public/templates/slide");
const FIXTURES = resolve(__dirname, "fixtures/templates");
const EXECUTIVE = resolve(PUBLIC, "エグゼクティブ_Executive_TemplateOnly.pptx");

const COVER = "# 表紙\n\nサブ\n\n---\n\n";
const kpi3 = (first: string) =>
  COVER + `# 3 つの効果\n\n<!-- kpi -->\n### コスト\n- ${first}\n- 前年比\n\n<!-- kpi -->\n### 問い合わせ\n- 40% 減\n\n<!-- kpi -->\n### 立ち上がり\n- 2 週`;
const LONG = "- 1,234,567 円";

const kpiIssues = (issues: DeckIssue[]) => issues.filter((i) => i.id === "kpi-value-overflow");
const diagnose = (md: string, t: TemplateData) => diagnoseDeck(parseMd(md), buildCatalog(t), t.layouts);

let report: TemplateData;
beforeAll(async () => {
  report = await loadTemplate(await writePresetTemplate(REPORT_PRESET));
});

describe("#643 kpi-value-overflow", () => {
  it("is registered as a warn rule", () => {
    expect(REVIEW_RULES).toContainEqual({ id: "kpi-value-overflow", level: "warn" });
  });

  it("KPI.3Value.Equal（生成テンプレ）に 1 行に収まらない値 → 1 件（warn・condense）", () => {
    const found = kpiIssues(diagnose(kpi3(LONG), report));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ slideIndex: 1, title: "3 つの効果", level: "warn", levers: ["condense"] });
    expect(found[0].message).toContain(`「${LONG}」`);
    expect(found[0].message).toContain("KPI.3Value.Equal");
  });

  it("MCP getDiagnostics（get_deck_issues の本体）にも出る", async () => {
    const s = S.createSession(null);
    await S.newProject(s, await writePresetTemplate(REPORT_PRESET), kpi3(LONG));
    expect(kpiIssues(S.getDiagnostics(s).issues)).toHaveLength(1);
  });

  it("収まる値（−18%）では 0 件", () => {
    expect(kpiIssues(diagnose(kpi3("−18%"), report))).toEqual([]);
  });

  it("KPI 以外のグループ（card）は対象外", () => {
    const md = COVER + `# カード\n\n<!-- card -->\n### A\n- ${LONG}${LONG}${LONG}\n\n<!-- card -->\n### B\n- b\n\n<!-- card -->\n### C\n- c`;
    expect(kpiIssues(diagnose(md, report))).toEqual([]);
  });

  it("テンプレ無し（2 引数）の diagnoseDeck は従来どおり 0 件", () => {
    expect(kpiIssues(diagnoseDeck(parseMd(kpi3(LONG))))).toEqual([]);
  });

  it("samples/manuscript-06-executive-brief.md を Executive で開くと 0 件", async () => {
    const t = await loadTemplate(readFileSync(EXECUTIVE));
    expect(kpiIssues(diagnose(readFileSync(resolve(ROOT, "samples/manuscript-06-executive-brief.md"), "utf8"), t))).toEqual([]);
  });

  it("同梱コーパスでの発火は、実際に折り返す 1 件だけ（誤検知なし）", async () => {
    const tpls: [string, TemplateData][] = [
      ["preset:report", report],
      ["preset:executive", await loadTemplate(await writePresetTemplate(EXECUTIVE_PRESET))],
      ["preset:pitch", await loadTemplate(await writePresetTemplate(PITCH_PRESET))],
    ];
    for (const dir of [PUBLIC, FIXTURES]) {
      for (const f of readdirSync(dir).filter((f) => f.endsWith(".pptx"))) tpls.push([f, await loadTemplate(readFileSync(resolve(dir, f)))]);
    }
    const mds: [string, string][] = readdirSync(resolve(ROOT, "samples"))
      .filter((f) => f.endsWith(".md"))
      .map((f) => [f, readFileSync(resolve(ROOT, "samples", f), "utf8")]);
    mds.push(["Pitch 見本", readFileSync(resolve(FIXTURES, "セールスピッチ_Pitch_全レイアウト見本.md"), "utf8")]);

    const hits: string[] = [];
    for (const [tn, t] of tpls) for (const [mn, md] of mds) for (const iss of kpiIssues(diagnose(md, t))) hits.push(`${tn} | ${mn} | ${iss.slideIndex}`);
    // LibreOffice で「4.2 / 億円」と 2 行に折り返し、下の KPI補足 と重なることを確認済み（PR 本文に画像）。
    expect(hits).toEqual(["報告書テンプレート_マガジン_生成りコーラル_全レイアウト見本.pptx | manuscript-06-executive-brief.md | 3"]);
  }, 60_000);
});
