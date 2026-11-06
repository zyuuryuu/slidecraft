# ADR-0038: MCP の stateless 化（2026-07-28）への追随 — 文書ハンドル・リソース購読・口＝プロファイル・薄い relay

- Status: Accepted（2026-11-06・ユーザ合意）
- Date: 2026-11-06

## Context

MCP 仕様 2026-07-28 版は stateless を核にした: `initialize`/`Mcp-Session-Id` 廃止・版と capability は各リクエストの
`_meta`・`server/discover` はサーバ必須・サーバ起点通知は `subscriptions/listen`・全結果に `resultType`。
TypeScript SDK は v2 に分割され、v1 は 2027-01 頃まで保守。SlideCraft は SDK v1 1.32 のままで、協働経路
（[ADR-0009](0009-p2-collab-host.md)・[ADR-0033](0033-mcp-single-control-plane.md)）が**接続＝セッション**・
接続ごとの active doc・SSE fan-out・relay の `initialize` 依存という廃止概念の上に立っている。実測では Claude Code の
版プローブ（`server/discover`）に無応答で legacy ハンドシェイクのみ動く（#514）。

サーフェスの整列（[ADR-0037](0037-mcp-surface-realignment.md)）直後のため、その下の層も同じ原理で揃える。
診断と全体像は [docs/design/mcp-stateless-realign.md](../design/mcp-stateless-realign.md)、本 ADR は決定部分を永続化する。

要件は 2 つ: (1) 新旧クライアントに壊れず応答し続ける、(2) **AI アプリ側の設定変更をゼロに保つ**。

## Decision

芯（ADR-0033/0015/0037 の「真実は一つ・口は薄く・契約はサーバが語る・ホットは痩せさせ続ける・消すのは証拠が出てから」）
は不変。その実装手段を次の 4 点で置き換える。

### D1. 文書ハンドル — 既定は front doc

- `docId` を唯一の状態キーとする。接続ごとの active doc は持たない。
- `docId` 省略時の既定は **front doc**（人が GUI で今表示している doc。GUI がタブ切替で管制へ告げる、接続非依存の
  グローバル状態）。solo は sole doc と一致する。
- `select_document` は GUI 専用（人の操作）に降格し、collab-ai の口からは外す。AI が別 doc を触るときは `docId` を明示する。

### D2. 変更通知はリソース購読

- `deck://{docId}` 系リソースに `resourceSubscriptions` を宣言し、GUI（と希望する AI）は `subscriptions/listen` で購読する。
- 変更は `notifications/resources/updated` で配る。`changedIndices`/`origin`（#407）は通知の `_meta` の
  `io.slidecraft/*` キーに載せる。独自通知 `deckChanged` と SSE fan-out は撤去する。
- legacy クライアントに通知は届かない。追随は GUI 側機能なので縮退ではない。

### D3. 口＝プロファイル

- stdio ＝ solo、loopback HTTP `/mcp` ＝ collab-ai、`/gui` ＝ collab-gui（GUI ロールの token で保護）。
- 各口の tools/list は不変（接続で変えない）。`tool-profiles.ts` の表を口の定義表とする。
- list 系と `resources/read` には `CacheableResult`（`ttlMs`・`cacheScope: public`）を付けてよい。

### D4. relay は管制を持たない薄い枠組みアダプタ

- forward モードは **1 stdio リクエスト → 1 HTTP POST**（`_meta` 素通し）の無状態転送。購読は `subscriptions/listen` の
  長命 POST を開いて流す。
- legacy stdio クライアントの `initialize` は SDK v2 の両時代受け（`serveStdio`）がローカルで答え、呼び出しだけ新形式で転送する。
- ADR-0033 の「relay はバイト中継」を「枠組みは解釈してよいが deck 状態・undo・doc lifecycle は持たない」に緩める。
  管制が 1 つという不変条件はそのまま。

### D5. 両時代受けと移行期限

- 同一コマンド `slidecraft-mcp`（別名 `slidecraft serve`）で 2026-07-28 と 2025 系（2025-06-18 / 2025-11-25）の両方を受ける。
  クライアントの更新タイミングに依存しない。legacy の打ち切りは、Claude 製品側の廃止期日が公表されてから別 ADR で判断する。
- SDK v2 への移行は v1 保守期限（2027-01 頃）前に完了させる。

### やらないこと

- Tasks 拡張（export は十分速い）・`structuredContent` の導入（ツール結果形の再設計がロードマップにあり待つ）・
  Roots/Sampling/Logging（未使用・非推奨化の影響ゼロ）。
- `docId` 必須化（U1 の「指示→見える」を濁す・既存呼び出し互換を壊す）。
- 同一 `/mcp` での token ロールによる tools/list 出し分け（仕様文言上グレー・監査も口ごとが明快）。

## Consequences

- **クライアント設定は不変**: AI アプリが知る識別子はコマンド名 1 語。版の協議・GUI の有無・プロファイルは入口層で吸収する。
  このため Windows/Linux にも `slidecraft-mcp` の PATH ランチャが要る（macOS cask と同じ契約）。
- ADR-0009 の「接続＝セッション・`deckChanged` SSE fan-out」と ADR-0033 の「relay はバイト中継」の記述は本 ADR が**補完**する
  （supersede ではない: 管制単一・GUI は対等クライアント・relay は管制を持たない、は存続）。
- 実装は #514 の子タスクに分割する（段 1 プローブ互換＋ランチャ → 段 3 SDK v2・`serveStdio` → 段 4 host/relay stateless 化
  ＋GUI クライアント更新 → 段 5 #513/#512 → 段 6 `.mcpb`）。各 PR は本 ADR の D1–D5 のどれに対応するかを本文で宣言する。
- 計測（#512）の単位はセッションではなく **doc ハンドル × 時間窓**になる。
- 要求ごとの `McpServer` 構築コストはツール表の 1 回構築で抑える（段 3 で実測）。

## References

- [docs/design/mcp-stateless-realign.md](../design/mcp-stateless-realign.md)（診断・全体像・未決）
- [ADR-0008](0008-mcp-tool-surface.md)・[ADR-0009](0009-p2-collab-host.md)・[ADR-0015](0015-mcp-brushup.md)・
  [ADR-0033](0033-mcp-single-control-plane.md)・[ADR-0035](0035-mcp-bulk-data-exchange.md)・[ADR-0037](0037-mcp-surface-realignment.md)
- 仕様: [2026-07-28 changelog](https://modelcontextprotocol.io/specification/latest/changelog)・SDK [v2 移行ガイド](https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2)
- #514（追跡）・#406・#512・#513・#465・#407
