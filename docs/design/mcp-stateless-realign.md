# MCP 再設計 第 2 部 — stateless（2026-07-28）を前提にした層の再整列（DISCUSS → ADR-0038）

- Status: 💬 DISCUSS → 決定部分は [ADR-0038](../adr/0038-mcp-stateless-realign.md) に永続化（2026-11-06・ユーザ合意）
- Date: 2026-11-06
- 参加: ユーザ・レビュー統括セッション
- 前編: [mcp-value-realign.md](mcp-value-realign.md)（サーフェスの整列・ADR-0037）。本書はその**下の層**（プロトコル・transport・管制の状態モデル）を扱う。

## 1. なぜ今か

MCP 仕様は **2026-07-28 版**で stateless 化した（[changelog](https://modelcontextprotocol.io/specification/latest/changelog)）。
`initialize` ハンドシェイクと `Mcp-Session-Id` が廃止され、版と capability は各リクエストの `_meta` に載る。
`server/discover` がサーバ実装必須、サーバ起点通知は GET/SSE から `subscriptions/listen` へ、全結果に
`resultType` が付く。TypeScript SDK は v2 でパッケージ分割（`@modelcontextprotocol/server` ほか）、v1 は
2026-07-27 から最低 6 ヶ月の保守（＝2027-01 頃が床）。

SlideCraft の MCP は SDK v1 1.32（知っている最新版は 2025-11-25）で、**協働経路が廃止概念に依存**している:
接続＝セッション（`sessionIdGenerator`）、`select_document` の接続ごとの active doc、`deckChanged` の SSE fan-out、
relay の `initialize`/`mcp-session-id` 依存。実測（2026-11-06・#514）では Claude Code の版プローブ
（`server/discover`）に**無応答**で、legacy ハンドシェイクでのみ動く。

サーフェス再設計（#406）が「何を見せるか」を整えた直後なので、「どう運ぶか」も同じ原理で揃える好機である。

## 2. 変えないこと（芯）

[ADR-0037](../adr/0037-mcp-surface-realignment.md) までの 5 句はそのまま: **真実は一つ**（ADR-0033）・
**口は薄く**（ADR-0033）・**契約はサーバが語る**（ADR-0015）・**ホットは痩せさせ続ける**（ADR-0037）・
**消すのは証拠が出てから**（ADR-0008/0037）。stateless 化はこの芯と相性がよい — 「口を薄く」を強制し、
`server/discover` は「契約はサーバが語る」の標準化である。変えるのは芯ではなく、芯を 2025 系の道具
（セッション・initialize・SSE）で実装していた部分。

## 3. 四つの転換

### A. 「接続」から「文書ハンドル」へ

現状: `select_document` が**接続ごとの active doc** を持ち、`docId` 省略時はそれに解決する。新仕様は接続状態を
持てない（tools/list を接続で変えない・状態はサーバ発行ハンドルを引数で渡す・SEP-2567）。

決定候補: **`docId` を唯一の状態キー**にし、省略時の既定を **front doc**（人が今 GUI で表示している doc・
GUI がタブ切替で管制に告げる接続非依存のグローバル状態）にする。AI が黙って `set_slide_markdown` を打てば
人が見ている deck が変わる — U1（ライブ共著）の意味論そのもの。`select_document` は人の操作（GUI 専用）に降格し、
AI が複数 doc を触るときだけ `docId` を明示する。solo は doc が 1 つなので front＝sole で自明（既存 `soleDocId()`）。

代替（不採用）: `docId` 必須化。複数 doc を AI に並行で任せる用途には明快だが、U1 の「指示→見える」を
毎回 docId 指定で濁すうえ、既存クライアントの呼び出し互換を壊す。必要なら `docId` 明示で同じことができる。

### B. 「セッション通知」から「リソース購読」へ

現状: 変更は `deckChanged`（独自通知）を接続ごとの SSE に fan-out。GET エンドポイントごと廃止される。

決定候補: **deck をリソースとして購読する**。`deck://{docId}`（および `slide://{docId}/{i}`）に
`resourceSubscriptions` を宣言し、GUI（と希望する AI）は `subscriptions/listen` で乗る。変更は
`notifications/resources/updated` で届き、`changedIndices`/`origin`（#407 の追随ハイライト）は通知の `_meta`
（`io.slidecraft/…` 名前空間）に載せる。ADR-0008 の「読み取りの二重面」が通知面としても意味を持つ。
legacy の AI クライアントには通知が届かないが、追随は GUI 側機能なので縮退ではない（彼らは元々通知を見ていない）。

### C. 「プロファイル＝口（エンドポイント）」

現状: #465 のプロファイル（solo / collab-gui / collab-ai）は接続ごとの `host.solo`/`sharedOnly` で登録を分ける。
新仕様の「tools/list は接続で変えない」とは**口ごとに固定**なら適合する。

決定候補: stdio ＝ solo、loopback HTTP `/mcp` ＝ collab-ai、`/gui` ＝ collab-gui（GUI ロールの token で保護）。
各口の tools/list は不変なので **`CacheableResult`（`ttlMs` 長め・`cacheScope: public`）**を付けられ、
クライアント側キャッシュで固定費（#513）と同じ方向に効く。`tool-profiles.ts` の表は「口の定義表」としてそのまま使う。

代替（不採用）: 同一 `/mcp` で token ロールによる出し分け。仕様文言上グレーで、監査（#466 の分類）も口ごとに
数えた方が明快。

### D. relay は「バイト中継」から「薄い枠組みアダプタ」へ

現状: forward モードは `initialize` の中継と `mcp-session-id` の捕捉に依存。新クライアントは initialize を送らない
ので起点を失う。

決定候補: relay は **1 stdio リクエスト → 1 HTTP POST（`_meta` 素通し）**の無状態転送。購読は `subscriptions/listen`
の長命 POST を開いて流す。legacy stdio クライアントの `initialize` は SDK v2 の両時代受け（`serveStdio`）が
ローカルで答え、ツール呼び出しだけを新形式で転送する。「管制を持たない」（ADR-0033 の不変条件）は維持し、
「バイトを一切解釈しない」だけを緩める。

## 4. 全体像

```
AI アプリ（Claude Code / Desktop / Cursor）        GUI（webview）
        │ stdio: `slidecraft-mcp`（3 OS で PATH）        │ loopback HTTP /gui
        ▼                                                 ▼
  ┌─ 入口層（薄い・両時代受け）────────────────────────────────┐
  │ serveStdio(factory)   ← 2026-07-28 と 2025 系を同一コマンドで │
  │   ├ GUI 稼働中 → relay: 1 req → 1 POST /mcp（状態なし）        │
  │   └ GUI 無し   → solo 管制を内蔵                              │
  │ createMcpHandler(factory) /mcp・/gui（stateless・legacy 併存）│
  └──────────────────────────────────────────────────────────────┘
        ▼ buildServer(profile)  ※ツール表は 1 回構築・インスタンスは要求ごと
  ┌─ 管制（唯一・host-core）───────────────────────────────────┐
  │ DocRegistry / commitMutation / undo / frontDoc /             │
  │ subscriptions（deck://{docId} の購読者表）                    │
  └──────────────────────────────────────────────────────────────┘
```

クライアント設定に現れるのは **`slidecraft-mcp` の 1 語だけ**。版の協議・GUI の有無・プロファイルは入口層で
吸収するので、AI アプリ側の設定変更はゼロ。

## 5. サーフェス側との合流（#406）

- `server/discover` ＝標準のコールド入口（識別・能力・対応版）、`bootstrap` ＝その上の著作契約。層が違うので二重ではない。
- #513（ホット説明文圧縮）＋ C の `CacheableResult` で、固定費を「減らす」と「再送しない」の両面から下げる。
- #512（計測）は `run()`/`mutate()` の choke point のまま。計測単位は「セッション」が無いので **doc ハンドル × 時間窓**
  （time-to-first-visual は front doc の最初の mutation まで）。
- Roots / Sampling / Logging / `ping` は未使用＝非推奨化の影響ゼロ。Tasks 拡張は export が十分速いので取らない。
  `structuredContent` はツール結果形の再設計がロードマップにあるため待つ。

## 6. 進め方（#514 の子と #512/#513 を 1 本に）

| 段 | 内容 | 規模 | 効果 |
| --- | --- | --- | --- |
| 1 | プローブ互換（`server/discover` に即応答）＋ Windows/Linux の `slidecraft-mcp` ランチャ | S＋S | 今日のクライアントで待ちゼロ・設定不変の土台 |
| 2 | ADR-0038（本書の決定部分） | S | 設計の確定 |
| 3 | SDK v2 移行＋ `serveStdio` 両時代受け（stdio solo） | M | AI アプリは何も変えずに新版へ |
| 4 | host/relay の stateless 化（A・B・C・D）＋ GUI クライアントを新版へ | M | 協働経路の完成 |
| 5 | #513 説明文圧縮＋ `CacheableResult`、#512 計測 | S＋S | ホット固定費・証拠収集 |
| 6 | `.mcpb` バンドル（Claude Desktop の JSON 編集ゼロ導入） | S（任意） | 導入体験 |

目標ライン: **v1 保守期限（2027-01 頃）前に 4 まで**。1 は互換性修正に近く先行可。

## 7. 不変条件（実装 PR が守るもの）

- legacy クライアント（2025-06-18 / 2025-11-25）は移行期間中ずっと動く（ユーザのクライアント更新に依存しない）。
- 管制は 1 つ（ADR-0033）。relay が第 2 の管制にならない。
- ツール名・入出力・プロファイル別登録の表（#465）は不変。説明文の圧縮は情報の「移動」であって削除ではない。
- 既存テスト群（mcp-session / structure / bootstrap / tool-profiles / relay / host）を全部通す。PPTX golden は無関係。
- test-first（R3）・engine 純度（R2）非影響。

## 8. 未決・リスク

- Claude Code のプローブ無応答時の挙動（タイムアウト長・ピン留め条件）は未実測 → 段 1 で実機測定して記録。
- 要求ごとに `McpServer` を組み立てるコスト（39 ツールの登録）→ ツール表を 1 回構築して再利用する前提で測る。
- GUI クライアントの新版移行は GUI 自身がクライアントなので自由度が高いが、`.scft` の version ゲート（#121）と
  同時期に触ると波及が広い → 別 PR で。
- ADR-0009（接続＝セッション・SSE fan-out）と ADR-0033（relay はバイト中継）の記述は本書で**補完**する
  （supersede ではない: 管制単一・GUI は対等クライアント・relay は管制を持たない、はそのまま）。

## References

- 仕様: [versioning](https://modelcontextprotocol.io/specification/versioning)・[2026-07-28 changelog](https://modelcontextprotocol.io/specification/latest/changelog)・[roadmap](https://modelcontextprotocol.io/development/roadmap)
- SDK: [v2 移行ガイド](https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2)・[2026-07-28 対応ガイド](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28.html)
- Anthropic: [Bringing MCP 2026-07-28 to Claude](https://claude.com/blog/bringing-mcp-2026-07-28-to-claude)・Claude Code changelog 2.1.299 / 2.1.302 / 2.1.318
- 関連 Issue: #514（追跡）・#406（サーフェス）・#512 / #513・#465・#407・#220
- 関連 ADR: [0008](../adr/0008-mcp-tool-surface.md)・[0009](../adr/0009-p2-collab-host.md)・[0015](../adr/0015-mcp-brushup.md)・[0033](../adr/0033-mcp-single-control-plane.md)・[0035](../adr/0035-mcp-bulk-data-exchange.md)・[0037](../adr/0037-mcp-surface-realignment.md)
