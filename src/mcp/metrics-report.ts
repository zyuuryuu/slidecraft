/**
 * metrics-report.ts — #512: 呼出ログ（metrics.ts の記録列）→ ADR-0037 D5 の 3 指標と D4 の証拠比率
 * （純関数・I/O なし。ファイルを読むのは scripts/mcp-metrics-report.ts）。
 *
 * 単位は **doc ハンドル × 時間窓**（ADR-0038）: stateless の MCP にはセッションが無いので、記録を時刻順に
 * 並べ、直前の呼出の終了から次の開始までが windowGapMs を超えたら次の窓とする。窓の中を doc ごとに
 * 分けたものが集計の 1 単位（doc 未確定＝null の呼出も窓の一員として別行に数える）。
 *
 *  - D5-1 time-to-first-visual: 窓の開始 → 最初に deck が実際に変わった呼出（changed:true）の完了まで。
 *    solo では sole doc＝front doc。collab で人の操作を外すなら profiles で collab-gui を除く。
 *  - D5-2 往復数/トークン: サーバからトークンは見えない（#512 fix 方針 3）ので、窓・単位ごとの呼出数と
 *    入出力の文字数（inChars/outChars）で代理する。説明文＋スキーマの固定費は #466 の o200k 計測を参照。
 *  - D5-3 増分性: 変化した edit のうち deck 丸ごと再生成（wholeDeck）の比率。
 *  - D4 証拠: design/mcp-value-realign.md §7.4 の削除候補ごとの比率（同じ語彙で出す）。
 */
import type { McpProfile } from "./tool-profiles";
import type { MetricsRecord } from "./metrics";

export interface ReportOptions {
  /** 集計対象のツール名の一覧＝TOOL_PROFILES のキー（R8: 第 2 の一覧を作らない — 呼び出し側が渡す）。 */
  tools: readonly string[];
  /** 窓を切る無呼出の間隔。既定 30 分。 */
  windowGapMs?: number;
  /** 指定時はこのプロファイルの記録だけを数える。 */
  profiles?: readonly McpProfile[];
}

export interface ToolStat { tool: string; calls: number; rate: number; ok: number; reject: number; error: number; meanMs: number | null; outChars: number }
export interface WindowStat { index: number; start: string; end: string; calls: number; docs: number; changes: number; ttfvMs: number | null; inChars: number; outChars: number }
export interface UnitStat { window: number; doc: string | null; calls: number; changes: number; wholeDeck: number; ttfvMs: number | null; inChars: number; outChars: number }
export interface Evidence {
  windows: number;
  wholeDeckShare: number | null;
  fixRequestPerGetSlide: number | null;
  slideMarkdownShare: number | null;
  projectInfoPerWindow: number | null;
  convertBulletsCalls: number;
  guideAliasShare: number | null;
}
export interface MetricsReport { totalCalls: number; tools: ToolStat[]; unknownTools: { tool: string; calls: number }[]; windows: WindowStat[]; units: UnitStat[]; evidence: Evidence }

export const DEFAULT_WINDOW_GAP_MS = 30 * 60_000;

/** bootstrap に統合された旧ガイド 4 本（§7.4 最下行・ADR-0037 D2）。 */
const GUIDE_ALIASES = ["get_authoring_guide", "get_diagram_types", "get_diagram_guide", "get_template_spec_guide"] as const;
/** 証拠比率が参照するツール名（テストが TOOL_PROFILES に実在することを検査する）。 */
export const EVIDENCE_TOOLS: readonly string[] = ["get_slide_fix_request", "get_slide", "get_slide_markdown", "get_project_info", "convert_bullets_to_table", "bootstrap", ...GUIDE_ALIASES];

const startOf = (r: MetricsRecord): number => Date.parse(r.ts);
const endOf = (r: MetricsRecord): number => startOf(r) + r.ms;
const ratio = (n: number, d: number): number | null => (d === 0 ? null : n / d);
const isChange = (r: MetricsRecord): boolean => r.changed === true;

function splitWindows(records: MetricsRecord[], gapMs: number): MetricsRecord[][] {
  const sorted = [...records].sort((a, b) => startOf(a) - startOf(b));
  const out: MetricsRecord[][] = [];
  let lastEnd = -Infinity;
  for (const r of sorted) {
    if (out.length === 0 || startOf(r) - lastEnd > gapMs) out.push([]);
    out[out.length - 1].push(r);
    lastEnd = Math.max(lastEnd, endOf(r));
  }
  return out;
}

const sum = (rs: MetricsRecord[], k: "inChars" | "outChars"): number => rs.reduce((n, r) => n + (r[k] ?? 0), 0);

function ttfv(rs: MetricsRecord[], windowStart: number): number | null {
  const first = rs.find(isChange);
  return first ? Math.round((endOf(first) - windowStart) * 10) / 10 : null;
}

function toolStats(records: MetricsRecord[], tools: readonly string[]): { tools: ToolStat[]; unknownTools: { tool: string; calls: number }[] } {
  const by = new Map<string, MetricsRecord[]>();
  for (const r of records) by.set(r.tool, [...(by.get(r.tool) ?? []), r]);
  const stat = (tool: string): ToolStat => {
    const rs = by.get(tool) ?? [];
    const n = (o: MetricsRecord["outcome"]) => rs.filter((r) => r.outcome === o).length;
    return { tool, calls: rs.length, rate: records.length ? rs.length / records.length : 0, ok: n("ok"), reject: n("reject"), error: n("error"), meanMs: rs.length ? rs.reduce((s, r) => s + r.ms, 0) / rs.length : null, outChars: sum(rs, "outChars") };
  };
  const known = new Set(tools);
  const unknownTools = [...by.keys()].filter((t) => !known.has(t)).sort().map((tool) => ({ tool, calls: by.get(tool)!.length }));
  return { tools: tools.map(stat), unknownTools };
}

export function aggregateMetrics(all: readonly MetricsRecord[], opts: ReportOptions): MetricsReport {
  const records = opts.profiles ? all.filter((r) => opts.profiles!.includes(r.profile)) : [...all];
  const groups = splitWindows(records, opts.windowGapMs ?? DEFAULT_WINDOW_GAP_MS);
  const windows: WindowStat[] = [];
  const units: UnitStat[] = [];
  groups.forEach((rs, index) => {
    const start = startOf(rs[0]);
    const docs: (string | null)[] = [];
    for (const r of rs) if (!docs.includes(r.doc)) docs.push(r.doc);
    windows.push({ index, start: rs[0].ts, end: new Date(Math.max(...rs.map(endOf))).toISOString(), calls: rs.length, docs: docs.filter((d) => d !== null).length, changes: rs.filter(isChange).length, ttfvMs: ttfv(rs, start), inChars: sum(rs, "inChars"), outChars: sum(rs, "outChars") });
    for (const doc of docs) {
      const us = rs.filter((r) => r.doc === doc);
      units.push({ window: index, doc, calls: us.length, changes: us.filter(isChange).length, wholeDeck: us.filter((r) => r.wholeDeck).length, ttfvMs: ttfv(us, start), inChars: sum(us, "inChars"), outChars: sum(us, "outChars") });
    }
  });
  const calls = (t: string) => records.filter((r) => r.tool === t).length;
  const changedEdits = records.filter((r) => r.mut === "edit" && r.changed);
  const guides = GUIDE_ALIASES.reduce((n, t) => n + calls(t), 0);
  const evidence: Evidence = {
    windows: windows.length,
    wholeDeckShare: ratio(changedEdits.filter((r) => r.wholeDeck).length, changedEdits.length),
    fixRequestPerGetSlide: ratio(calls("get_slide_fix_request"), calls("get_slide")),
    slideMarkdownShare: ratio(calls("get_slide_markdown"), calls("get_slide") + calls("get_slide_markdown")),
    projectInfoPerWindow: ratio(calls("get_project_info"), windows.length),
    convertBulletsCalls: calls("convert_bullets_to_table"),
    guideAliasShare: ratio(guides, guides + calls("bootstrap")),
  };
  return { totalCalls: records.length, ...toolStats(records, opts.tools), windows, units, evidence };
}

const pct = (x: number | null): string => (x === null ? "—" : `${(x * 100).toFixed(1)}%`);
const num = (x: number | null, d = 1): string => (x === null ? "—" : x.toFixed(d));

/** 人が読む Markdown（呼出率表・窓表・単位表・3 指標・§7.4 証拠）。 */
export function renderMetricsReport(rep: MetricsReport): string {
  const L: string[] = [];
  L.push("# SlideCraft MCP 呼出ログ集計", "", `総呼出 ${rep.totalCalls}・窓 ${rep.windows.length}・単位（doc × 窓）${rep.units.length}`, "");
  L.push("## ツール別呼出率", "", "| ツール | 呼出 | 率 | ok | reject | error | 平均 ms | 出力文字 |", "| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const t of rep.tools) L.push(`| ${t.tool} | ${t.calls} | ${pct(t.rate)} | ${t.ok} | ${t.reject} | ${t.error} | ${num(t.meanMs)} | ${t.outChars} |`);
  if (rep.unknownTools.length) L.push("", `表（TOOL_PROFILES）に無いツール名: ${rep.unknownTools.map((u) => `${u.tool}（${u.calls}）`).join("・")}`);
  L.push("", "## 時間窓（往復数・time-to-first-visual）", "", "| 窓 | 開始 | 呼出 | doc 数 | 変化 | time-to-first-visual ms | 入力文字 | 出力文字 |", "| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const w of rep.windows) L.push(`| ${w.index} | ${w.start} | ${w.calls} | ${w.docs} | ${w.changes} | ${num(w.ttfvMs)} | ${w.inChars} | ${w.outChars} |`);
  L.push("", "## doc × 窓", "", "| 窓 | doc | 呼出 | 変化 | 丸ごと再生成 | time-to-first-visual ms |", "| --- | --- | --- | --- | --- | --- |");
  for (const u of rep.units) L.push(`| ${u.window} | ${u.doc ?? "（doc 未確定）"} | ${u.calls} | ${u.changes} | ${u.wholeDeck} | ${num(u.ttfvMs)} |`);
  const e = rep.evidence;
  L.push("", "## 証拠比率（design/mcp-value-realign.md §7.4 の語彙・実セッション＝窓）", "", "| 指標 | 値 |", "| --- | --- |");
  L.push(`| 窓数 N | ${e.windows} |`);
  L.push(`| 増分性: 丸ごと再生成 / 変化した edit | ${pct(e.wholeDeckShare)} |`);
  L.push(`| get_slide_fix_request / get_slide | ${pct(e.fixRequestPerGetSlide)} |`);
  L.push(`| get_slide_markdown /(get_slide + get_slide_markdown) | ${pct(e.slideMarkdownShare)} |`);
  L.push(`| get_project_info / 窓 | ${num(e.projectInfoPerWindow, 2)} |`);
  L.push(`| convert_bullets_to_table 呼出 | ${e.convertBulletsCalls} |`);
  L.push(`| 旧ガイド 4 本 /(旧ガイド + bootstrap) | ${pct(e.guideAliasShare)} |`);
  return L.join("\n") + "\n";
}
