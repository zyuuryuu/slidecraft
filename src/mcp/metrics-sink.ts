/**
 * metrics-sink.ts — #512: 呼出ログの**唯一のファイル I/O**（ローカル JSONL への追記のみ・外部送信なし —
 * ADR-0016）。計測は既定 OFF: この recorder を作るのは `--metrics <path>`（cli.ts・solo）と
 * `SLIDECRAFT_MCP_METRICS`（host-main.ts・collab）だけで、作られなければファイルは一切触られない。
 *
 * 失敗は監査ログ側の問題であってツール呼出を壊さない: 書き込みエラーは stderr に 1 度だけ告げ
 * （never-silent）、以後の記録を止める。
 */
import { appendFileSync } from "fs";
import { performance } from "perf_hooks";

/** 記録先。now() は epoch ms（小数可）・write() は改行なしの 1 行。テストは決定論の実装を注入する。 */
export interface MetricsRecorder {
  now(): number;
  write(line: string): void;
}

export function createFileMetricsRecorder(path: string): MetricsRecorder {
  let broken = false;
  return {
    now: () => performance.timeOrigin + performance.now(),
    write: (line) => {
      if (broken) return;
      try {
        // 最初の記録で作成（0600）。親ディレクトリは作らない（指定ミスを黙って吸収しない）。
        appendFileSync(path, line + "\n", { encoding: "utf8", mode: 0o600 });
      } catch (e) {
        broken = true;
        process.stderr.write(`slidecraft mcp: metrics log disabled — cannot append to ${path} (${e instanceof Error ? e.message : String(e)})\n`);
      }
    },
  };
}
