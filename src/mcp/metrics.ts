/**
 * metrics.ts — #512: MCP 呼出ログ 1 行の形（純関数・I/O なし）。
 *
 * ADR-0037 D4/D5 の証拠（ツール呼出頻度・time-to-first-visual・往復数・増分性）を集めるための
 * **ローカル監査ログ**であってテレメトリではない（ADR-0016: 外部送信しない）。1 行＝1 ツール呼出の
 * JSON Lines。載せるのはツール名・プロファイル・doc ハンドル・時刻・数値・列挙語だけで、deck 本文・
 * Markdown・base64・エラーメッセージは**載せない**（outcome と guard の code 列挙語のみ）。
 *
 * 計測の単位は「セッション」ではなく **doc ハンドル × 時間窓**（ADR-0038 Consequences）— 行は
 * セッション ID を持たず、集計（metrics-report.ts）が doc と時刻から窓を切る。
 *
 * 行の組み立てに要る事実はそれぞれ既存の 1 箇所から取る（R8）: 成否は result-contract.ts の isOk、
 * 変更スライドは host-core.ts の changedIndicesOf（server.ts の mutate が観測に渡す）、プロファイルは
 * tool-profiles.ts の profileOf。
 */
import type { ToolResult } from "./tool-result";
import type { McpProfile } from "./tool-profiles";
import { isOk } from "./result-contract";

export const METRICS_VERSION = 1 as const;

/** ok＝成功 / reject＝{ok:false}（guard・stale・no-op 拒否など modeled な失敗）/ error＝isError か throw。 */
export type MetricsOutcome = "ok" | "reject" | "error";
/** edit＝deck 編集（mutate 経由）/ mint＝open・new・use_template の新 doc / undo＝undo・redo。 */
export type ChangeKind = "edit" | "mint" | "undo";

/** ツール呼出 1 回の間にサーバ内部が記す観測（metrics-probe.ts の AsyncLocalStorage に載る）。 */
export interface CallObservation {
  docId?: string;
  change?: { kind: ChangeKind; changed: boolean; changedIndices: number[] | undefined };
}

export interface MetricsRecord {
  v: typeof METRICS_VERSION;
  /** 呼出開始（ISO 8601）。 */
  ts: string;
  tool: string;
  profile: McpProfile;
  /** 解決された doc ハンドル。doc に触れない呼出（bootstrap 前のガイド等）は null。 */
  doc: string | null;
  /** 所要時間（ms・0.1 丸め）。 */
  ms: number;
  outcome: MetricsOutcome;
  /** reject の列挙語（GuardCode 等）。列挙語の形をしていない値は載せない。 */
  code?: string;
  /** expectedRev 不一致の stale 拒否。 */
  stale?: true;
  /** 引数 JSON の文字数（トークンの代理・#512 fix 方針 3）。 */
  inChars: number;
  /** 結果 content の文字数（text は長さ・image は base64 の長さ）。 */
  outChars: number;
  mut?: ChangeKind;
  changed?: boolean;
  /** 変化したスライド数。null＝粒度不明（deck 丸ごと置換・undo/redo・mint）。 */
  changedN?: number | null;
  /** deck 丸ごと再生成（edit が変化し、かつ変更スライドが特定できない）＝D5-3 増分性の反例。 */
  wholeDeck?: boolean;
}

export interface BuildRecordInput {
  tool: string;
  profile: McpProfile;
  startMs: number;
  endMs: number;
  /** ツール引数（入力スキーマ無しのツールは undefined）。文字数だけを数える。 */
  args: unknown;
  /** ツールの戻り。handler が throw したら undefined（→ error）。 */
  result: ToolResult | undefined;
  obs: CallObservation;
}

const CODE_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const round1 = (n: number): number => Math.round(n * 10) / 10;

function rejectDetail(result: ToolResult): { code?: string; stale?: true } {
  const text = result.content.find((c) => c.type === "text");
  if (!text || text.type !== "text") return {};
  try {
    const p = JSON.parse(text.text) as { code?: unknown; stale?: unknown };
    return {
      ...(typeof p.code === "string" && CODE_RE.test(p.code) ? { code: p.code } : {}),
      ...(p.stale === true ? { stale: true as const } : {}),
    };
  } catch {
    return {};
  }
}

function outcomeOf(result: ToolResult | undefined): Pick<MetricsRecord, "outcome" | "code" | "stale"> {
  if (!result || result.isError) return { outcome: "error" };
  if (isOk(result)) return { outcome: "ok" };
  return { outcome: "reject", ...rejectDetail(result) };
}

const outCharsOf = (result: ToolResult | undefined): number =>
  (result?.content ?? []).reduce((n, c) => n + (c.type === "text" ? c.text.length : c.data.length), 0);

export function buildRecord(i: BuildRecordInput): MetricsRecord {
  const ch = i.obs.change;
  const changedN = ch?.changedIndices ? ch.changedIndices.length : null;
  return {
    v: METRICS_VERSION,
    ts: new Date(i.startMs).toISOString(),
    tool: i.tool,
    profile: i.profile,
    doc: i.obs.docId ?? null,
    ms: round1(i.endMs - i.startMs),
    ...outcomeOf(i.result),
    inChars: i.args === undefined ? 0 : JSON.stringify(i.args).length,
    outChars: outCharsOf(i.result),
    ...(ch ? { mut: ch.kind, changed: ch.changed, changedN, wholeDeck: ch.kind === "edit" && ch.changed && changedN === null } : {}),
  };
}

/** JSON Lines の 1 行（改行なし）。 */
export const formatMetricsLine = (r: MetricsRecord): string => JSON.stringify(r);

const isRecord = (x: unknown): x is MetricsRecord => {
  const r = x as Partial<MetricsRecord> | null;
  return !!r && typeof r === "object" && r.v === METRICS_VERSION && typeof r.tool === "string" && typeof r.ts === "string" && !Number.isNaN(Date.parse(r.ts)) && typeof r.ms === "number";
};

/** JSONL → 記録列。壊れた行・版違い・空行以外の非記録は skipped に数える（黙って捨てない）。 */
export function parseMetricsLines(text: string): { records: MetricsRecord[]; skipped: number } {
  const records: MetricsRecord[] = [];
  let skipped = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const x: unknown = JSON.parse(line);
      if (isRecord(x)) records.push(x);
      else skipped++;
    } catch {
      skipped++;
    }
  }
  return { records, skipped };
}
