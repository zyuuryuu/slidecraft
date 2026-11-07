/**
 * mcp-metrics-report.ts — #512: MCP 呼出ログ（JSONL）→ ツール別呼出率・時間窓ごとの往復数と
 * time-to-first-visual・丸ごと再生成比率・design/mcp-value-realign.md §7.4 の証拠比率（Markdown）。
 *
 * ログの取り方: `slidecraft serve --metrics <path>`（solo）／ `SLIDECRAFT_MCP_METRICS=<path>`（collab host）。
 * 集計は src/mcp/metrics-report.ts の純関数。ツール名の一覧は TOOL_PROFILES の表から取る（R8）。
 *
 * Usage:
 *   npx tsx scripts/mcp-metrics-report.ts <log.jsonl>... [--window-min 30] [--profile solo,collab-ai] [--json]
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseMetricsLines, type MetricsRecord } from "../src/mcp/metrics";
import { aggregateMetrics, renderMetricsReport, DEFAULT_WINDOW_GAP_MS } from "../src/mcp/metrics-report";
import { TOOL_PROFILES, type McpProfile } from "../src/mcp/tool-profiles";

const USAGE = "Usage: npx tsx scripts/mcp-metrics-report.ts <log.jsonl>... [--window-min 30] [--profile solo,collab-ai] [--json]";
const PROFILES: McpProfile[] = ["solo", "collab-gui", "collab-ai"];

export interface ReportRun { code: number; stdout: string; stderr: string }

/** 引数とファイル読み出し関数から出力を作る（テストはこれを直接呼ぶ。process には触らない）。 */
export function runReport(argv: readonly string[], readFile: (path: string) => string): ReportRun {
  const usage = (msg: string): ReportRun => ({ code: 2, stdout: "", stderr: `mcp-metrics-report: ${msg}\n${USAGE}\n` });
  const files: string[] = [];
  let windowGapMs = DEFAULT_WINDOW_GAP_MS;
  let profiles: McpProfile[] | undefined;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") json = true;
    else if (a === "--window-min") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n <= 0) return usage("--window-min には正の分数が必要です");
      windowGapMs = n * 60_000;
    } else if (a === "--profile") {
      const v = (argv[++i] ?? "").split(",").filter(Boolean);
      if (!v.length || v.some((p) => !PROFILES.includes(p as McpProfile))) return usage(`--profile は ${PROFILES.join(" / ")} のカンマ区切り`);
      profiles = v as McpProfile[];
    } else if (a.startsWith("--")) return usage(`不明なオプション: ${a}`);
    else files.push(a);
  }
  if (!files.length) return usage("ログファイルを 1 つ以上指定してください");

  const records: MetricsRecord[] = [];
  let skipped = 0;
  for (const f of files) {
    const r = parseMetricsLines(readFile(f));
    records.push(...r.records);
    skipped += r.skipped;
  }
  const report = aggregateMetrics(records, { tools: Object.keys(TOOL_PROFILES), windowGapMs, profiles });
  return {
    code: 0,
    stdout: json ? JSON.stringify({ ...report, skippedLines: skipped }, null, 2) + "\n" : renderMetricsReport(report),
    // 読めなかった行は黙って捨てない（never-silent）。
    stderr: skipped ? `mcp-metrics-report: ${skipped} 行を読み飛ばしました（JSON でない・版違い）\n` : "",
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = runReport(process.argv.slice(2), (p) => readFileSync(p, "utf8"));
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exitCode = r.code;
}
