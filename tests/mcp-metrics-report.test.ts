/**
 * mcp-metrics-report.test.ts — #512: 呼出ログの集計（純関数 aggregateMetrics / renderMetricsReport）と
 * 集計スクリプト（scripts/mcp-metrics-report.ts の runReport）。単位は「doc ハンドル × 時間窓」
 * （ADR-0038）。fixture JSONL から ツール別呼出率・窓別往復数・time-to-first-visual・丸ごと再生成比率・
 * design/mcp-value-realign.md §7.4 の証拠比率を出す。ログ 1 行の形と差し込み点は mcp-metrics.test.ts。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { TOOL_PROFILES } from "../src/mcp/tool-profiles";
import { parseMetricsLines, type MetricsRecord } from "../src/mcp/metrics";
import { aggregateMetrics, renderMetricsReport, EVIDENCE_TOOLS } from "../src/mcp/metrics-report";
import { runReport } from "../scripts/mcp-metrics-report";

describe("集計（doc ハンドル × 時間窓）", () => {
  const load = () => parseMetricsLines(readFileSync(resolve(__dirname, "fixtures/mcp-metrics/sample.jsonl"), "utf8")).records;
  const tools = Object.keys(TOOL_PROFILES);

  it("ツール別呼出率: 表の全ツールを 0 件も含めて列挙し、表に無い名前は unknownTools へ", () => {
    const rep = aggregateMetrics(load(), { tools });
    expect(rep.totalCalls).toBe(13);
    expect(rep.tools.map((t) => t.tool)).toEqual([...tools]);
    const ssm = rep.tools.find((t) => t.tool === "set_slide_markdown")!;
    expect(ssm).toMatchObject({ calls: 3, ok: 2, reject: 1, error: 0 });
    expect(ssm.rate).toBeCloseTo(3 / 13, 10);
    expect(rep.tools.find((t) => t.tool === "get_deck")).toMatchObject({ calls: 0, rate: 0 });
    expect(rep.unknownTools).toEqual([{ tool: "legacy_tool", calls: 1 }]);
  });

  it("時間窓: 無呼出の間隔が windowGapMs を超えたら次の窓。窓ごとの往復数と time-to-first-visual", () => {
    const rep = aggregateMetrics(load(), { tools, windowGapMs: 30 * 60_000 });
    expect(rep.windows).toHaveLength(2);
    expect(rep.windows[0]).toMatchObject({ index: 0, start: "2026-11-07T10:00:00.000Z", calls: 7, changes: 3, ttfvMs: 1100 });
    // 窓 1: set_slide_markdown の no-op（changed:false）は first-visual にならない → convert の完了時刻
    expect(rep.windows[1]).toMatchObject({ index: 1, start: "2026-11-07T11:00:00.000Z", calls: 6, changes: 1, ttfvMs: 5020 });
    // 窓の間隔を広げれば 1 窓
    expect(aggregateMetrics(load(), { tools, windowGapMs: 2 * 60 * 60_000 }).windows).toHaveLength(1);
  });

  it("doc ハンドル × 窓の単位: doc 未確定（null）の呼出も窓の一員として別行に数える", () => {
    const rep = aggregateMetrics(load(), { tools, windowGapMs: 30 * 60_000 });
    const units = rep.units.map((u) => ({ window: u.window, doc: u.doc, calls: u.calls, changes: u.changes, wholeDeck: u.wholeDeck, ttfvMs: u.ttfvMs }));
    expect(units).toEqual([
      { window: 0, doc: null, calls: 1, changes: 0, wholeDeck: 0, ttfvMs: null },
      { window: 0, doc: "doc-A", calls: 6, changes: 3, wholeDeck: 1, ttfvMs: 1100 },
      { window: 1, doc: "doc-B", calls: 6, changes: 1, wholeDeck: 0, ttfvMs: 5020 },
    ]);
  });

  it("増分性と #466 §7.4 の証拠比率（分母 0 は null）", () => {
    const rep = aggregateMetrics(load(), { tools, windowGapMs: 30 * 60_000 });
    expect(rep.evidence).toEqual({
      windows: 2,
      wholeDeckShare: 1 / 3, // 変化した edit 3 件のうち set_deck_markdown 1 件
      fixRequestPerGetSlide: 1 / 2,
      slideMarkdownShare: 1 / 3, // get_slide_markdown /(get_slide + get_slide_markdown)
      projectInfoPerWindow: 1 / 2,
      convertBulletsCalls: 1,
      guideAliasShare: 0, // 旧ガイド 4 本 0 回 / (0 + bootstrap 1)
    });
    expect(aggregateMetrics([], { tools }).evidence).toEqual({
      windows: 0, wholeDeckShare: null, fixRequestPerGetSlide: null, slideMarkdownShare: null, projectInfoPerWindow: null, convertBulletsCalls: 0, guideAliasShare: null,
    });
  });

  it("profiles で絞れる（collab-gui＝人の操作を AI 指標から外す用途）", () => {
    const gui: MetricsRecord = { v: 1, ts: "2026-11-07T10:00:00.500Z", tool: "set_slide_markdown", profile: "collab-gui", doc: "doc-A", ms: 1, outcome: "ok", inChars: 1, outChars: 1, mut: "edit", changed: true, changedN: 1, wholeDeck: false };
    const rep = aggregateMetrics([...load(), gui], { tools, profiles: ["solo", "collab-ai"] });
    expect(rep.totalCalls).toBe(13);
    expect(rep.windows[0].ttfvMs).toBe(1100);
    expect(aggregateMetrics([...load(), gui], { tools }).windows[0].ttfvMs).toBe(501);
  });

  it("R8: 証拠比率が参照するツール名はすべて TOOL_PROFILES の表に実在する", () => {
    const phantom = EVIDENCE_TOOLS.filter((n) => !(n in TOOL_PROFILES));
    expect(phantom).toEqual([]);
  });

  it("renderMetricsReport: 呼出率表・窓表・証拠比率（§7.4 の語彙）を Markdown で出す", () => {
    const md = renderMetricsReport(aggregateMetrics(load(), { tools, windowGapMs: 30 * 60_000 }));
    expect(md).toMatch(/\| set_slide_markdown \| 3 \| 23\.1% \| 2 \| 1 \| 0 \|/);
    expect(md).toMatch(/\| get_deck \| 0 \| 0\.0% \|/);
    expect(md).toContain("legacy_tool");
    expect(md).toMatch(/time-to-first-visual/);
    expect(md).toMatch(/get_slide_fix_request \/ get_slide \| 50\.0%/);
    expect(md).toMatch(/窓数 N \| 2/);
  });
});

describe("#631: 編集経路（ops 率）", () => {
  const tools = Object.keys(TOOL_PROFILES);
  const rec = (k: number, extra: Partial<MetricsRecord>): MetricsRecord =>
    ({ v: 1, ts: new Date(Date.parse("2026-11-08T00:00:00.000Z") + k * 1000).toISOString(), tool: "set_slide_markdown", profile: "solo", doc: "d", ms: 1, outcome: "ok", inChars: 1, outChars: 1, ...extra });
  it("経路を記録した呼出のうち ops 経路（OPS_ROUTES）の比率と skip 合計。経路の無い旧行は分母に入れない", () => {
    const rs = [
      rec(0, {}), // 旧行（route 無し）
      rec(1, { route: "markdown", skipped: 0 }),
      rec(2, { route: "field-ops", skipped: 1 }),
      rec(3, { route: "diagram-ops", skipped: 0 }),
      rec(4, { route: "fallback", skipped: 0 }),
    ];
    const rep = aggregateMetrics(rs, { tools });
    expect(rep.routes).toEqual({ recorded: 4, ops: 2, opsShare: 2 / 4, skipped: 1 });
    expect(renderMetricsReport(rep)).toMatch(/\| 編集経路: ops \/ 経路を記録した呼出（#106） \| 50\.0%（2\/4・skip 1） \|/);
    expect(aggregateMetrics([rec(0, {})], { tools }).routes).toEqual({ recorded: 0, ops: 0, opsShare: null, skipped: 0 });
    expect(renderMetricsReport(aggregateMetrics([], { tools }))).toMatch(/\| 編集経路: ops \/ 経路を記録した呼出（#106） \| —（0\/0・skip 0） \|/);
  });
});

describe("集計スクリプト scripts/mcp-metrics-report.ts", () => {
  const fixture = resolve(__dirname, "fixtures/mcp-metrics/sample.jsonl");
  const read = (p: string) => readFileSync(p, "utf8");

  it("fixture JSONL から呼出率表と証拠比率を出し、読み飛ばし行を stderr で告げる", () => {
    const r = runReport([fixture], read);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/\| set_slide_markdown \| 3 \| 23\.1% \| 2 \| 1 \| 0 \|/);
    expect(r.stdout).toMatch(/窓数 N \| 2/);
    expect(r.stderr).toMatch(/1 行を読み飛ばしました/);
  });

  it("--json・--window-min・--profile を解釈し、不正な引数は exit 2", () => {
    const j = JSON.parse(runReport([fixture, "--json", "--window-min", "120"], read).stdout) as { windows: unknown[]; skippedLines: number };
    expect(j.windows).toHaveLength(1);
    expect(j.skippedLines).toBe(1);
    expect(JSON.parse(runReport([fixture, "--json", "--profile", "collab-ai"], read).stdout)).toMatchObject({ totalCalls: 0 });
    expect(runReport([], read).code).toBe(2);
    expect(runReport([fixture, "--profile", "nope"], read).code).toBe(2);
    expect(runReport([fixture, "--window-min", "0"], read).code).toBe(2);
    expect(runReport([fixture, "--bogus"], read).code).toBe(2);
  });
});
