/**
 * metrics-probe.ts — #512: ツール呼出の計測の差し込み点（1 箇所）。
 *
 * 全ツールは tool-profiles.ts の gatedToolRegistrar を通って登録される（ADR-0037 D2）。計測が有効な
 * ときだけ、そのゲートが各 handler を instrumentTool で包む＝run()/mutate()/openInHost のどれを
 * 通る呼出も漏れなく 1 行になる。計測 OFF では包まない（登録される handler も応答も不変）。
 *
 * handler の内側で分かる事実（解決した docId・deck が変わったか）は、呼出ごとの CallObservation に
 * AsyncLocalStorage 経由で記す（noteDoc / noteChange）。同一接続の並行呼出でも混線しない。計測 OFF
 * では store が無く、note* は何もしない。
 */
import { AsyncLocalStorage } from "async_hooks";
import type { McpProfile } from "./tool-profiles";
import type { ToolResult } from "./tool-result";
import { buildRecord, formatMetricsLine, type CallObservation, type ChangeKind } from "./metrics";
import type { MetricsRecorder } from "./metrics-sink";

const store = new AsyncLocalStorage<CallObservation>();

/** この呼出が解決した doc ハンドル（server.ts の entryOf / openInHost が記す）。 */
export function noteDoc(docId: string): void {
  const o = store.getStore();
  if (o) o.docId = docId;
}

/** この呼出が deck を変えたか（server.ts の mutate / openInHost / undo・redo が記す）。 */
export function noteChange(kind: ChangeKind, changed: boolean, changedIndices?: number[]): void {
  const o = store.getStore();
  if (o) o.change = { kind, changed, changedIndices };
}

type Handler = (...a: unknown[]) => ToolResult | Promise<ToolResult>;

/** handler を包んで 1 呼出 1 行を recorder に書く。入力スキーマ有りのツールは (args, extra)、無しは (extra)。 */
export function instrumentTool(tool: string, profile: McpProfile, hasInput: boolean, cb: Handler, rec: MetricsRecorder): Handler {
  return async (...a: unknown[]) => {
    const obs: CallObservation = {};
    const startMs = rec.now();
    let result: ToolResult | undefined;
    try {
      result = await store.run(obs, () => cb(...a));
      return result;
    } finally {
      rec.write(formatMetricsLine(buildRecord({ tool, profile, startMs, endMs: rec.now(), args: hasInput ? a[0] : undefined, result, obs })));
    }
  };
}
