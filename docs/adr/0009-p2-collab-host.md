# ADR-0009: P2 協働ホストモデル（sidecar=真実・双方向・配布）

- **Status**: Accepted
- **Date**: 2026-06（R1+R2 設計を経て P2.3〜P2.5a で実装）

## Context
- 北極星（[[collab_host_model]]）：人間が GUI を起動 → MCP エンドポイントが自動起動。GUI が**ホスト**。上流 AI は stdio 子を spawn するのではなく**接続してくる**。AI の編集が GUI にライブ反映され、人間が観察＋直接編集する。
- 中心の分岐は「deck の真実はどこに住むか」。truth-in-webview（全 tool 呼び出しを Tauri IPC で webview にトンネルし、Rust で Origin 検証を再実装）と二重コピー（divergence 再発）はいずれも穴。
- 課題：従来は MCP server（`session.ts`）と GUI（React store）が別々の deck を持つ。協働には両者が触れる**ひとつの生きた deck**が要る。
- 制約：stdio ベースライン（`cli.ts`・正の AI→PPTX）をバイト不変に保つこと、scoped-fs の穴を再び開けないこと、3 OS で配布できること。

## Decision
- **真実は Node サイドカー**：起動が `dist/mcp/host.cjs` を auto-start し、その中の `DocRegistry` が唯一の真実。webview も AI も**同じサイドカーに対等な MCP クライアントとして接続**する。webview は rev 付きの**射影**であって競合コピーではない。
- **トランスポート**：loopback Streamable-HTTP（`127.0.0.1`・ephemeral port=0／既定 5174）。SDK は **1 McpServer = 1 transport**（`protocol.js`）なので接続ごとに `{McpServer, transport}` ペアを生成し、`DocRegistry` を共有。deck 変更は全接続クライアントへ `deckChanged` を**fan-out**（単一 notification ではなくループ）。
- **multi-doc**：`DocRegistry = Map<docId, DocEntry>`。各 `DocEntry` が deck Session・前進のみの `rev`・undo `HState` を持つ。`select_document` で接続ごとの active-doc を解決。`session.ts`/`cli.ts` は単一 doc・純粋のまま。
- **server-side undo**：純 `historyReducer`（`src/shared/history-core.ts`・React/zod 非依存）を session/GUI/host で共有。`rev` は committed mutation でも undo/redo でも**単調増加**（undo は過去 deck を指す新 rev を mint）。AI tool 呼び出しと中継された人間 GUI 編集が共に `commitMutation` を通り、**doc あたり 1 本の undo タイムライン**になる。GUI の Undo は host モードで host の undo/redo に再ルート。
- **双方向（human↔AI）**：人間の per-slide 編集は楽観ローカル適用＋debounce(600ms)で `set_slide_markdown`（`expectedRev` ガード／`opId` echo 抑制）として host へ往復。1 本のタイムライン・1 つの真実。
- **セキュリティ境界 = per-launch 256bit bearer token**（`crypto.timingSafeEqual`）。Origin 許可リストは belt（webview は Rust plugin-http 経由で Origin 無し）。bind は `127.0.0.1` 限定、`{url,token}` は `host.json`（0600）で publish。
- **lifecycle（`src-tauri/src/collab.rs`）**：Rust がサイドカーを spawn し**所有**、`SLIDECRAFT_READY {url,token}` stdout を受領して webview へ渡す。`RunEvent::ExitRequested/Exit` で kill+wait し host.json を削除。**Rust は DeckIR に一切触れない**（scoped-fs の穴は閉じたまま）。
- **配布**：stock node を `externalBin`、`host.cjs` を resources で同梱。release-only overlay（`tauri.bundle.conf.json`）＋クロスプラットフォーム staging（`scripts/stage-node.mjs`）。node-sea/pkg は notarization 税で却下。

## Consequences
- **可能になること**：AI と人間が 1 本のタイムライン上で双方向編集し、サーバ側 undo がどちらの手も巻き戻せる。複数 doc を 1 サイドカーで保持。stdio ベースラインは無変更で再利用（dual-mode）。
- **意図的な制限**：人間→AI フィードバックはスコープ外（人間は自分の AI チャットで指示）。MCP **resources は host モードで無効化**（可視性は GUI が担う）。SSE GET-leg は plugin-http で不確実なため poll(1.2s) が確実な床。
- **トレードオフ／既知の課題**：mac 署名なしは Gatekeeper で同梱 node が killed の恐れ（要 Developer ID＋notarization）。Windows ACL ロックダウン未実装（per-launch token ローテーション依存）。Rust パニック/外部 kill では孤児化し得る。`start_collab` は READY まで core thread を一時ブロック。
- **do-NOT-undo ガードレール**：
  - 真実は**サイドカー1箇所**。webview を競合コピーに戻さない（射影のみ）。
  - **Rust は DeckIR に触れない**。tool をトンネルして Rust 側で truth/Origin 検証を再実装しない。
  - `rev` は**前進のみ**（undo も新 rev を mint）。`onMutate`/history-push は **8 mutating ハンドラ限定**（read で `deckChanged` を飛ばさない）。
  - `cli.ts`（stdio）はバイト不変。host の追加は第2トランスポート＋broadcast＋`registerResources:false` のみ。
  - bearer token が書き込みの実トラスト境界。socket は将来の opt-in どまり（webview/url-transport は AF_UNIX を dial できない）。

## References
- 設計：`docs/design/p2-collab-design.md`（R1+R2＋P2.3/P2.4/P2.5a 実装ノート）
- コード：`src/mcp/host.ts`（listener・fan-out broadcast）、`src/mcp/host-core.ts`（`DocRegistry`/`DocEntry`/`commitMutation`/`undoDoc`）、`src/mcp/host-security.ts`（token/Origin）、`src/mcp/host-json.ts`、`src/mcp/server.ts`（`buildServer({onMutate,registerResources})`）、`src/shared/history-core.ts`、`src-tauri/src/collab.rs`（サイドカー lifecycle）
- webview：`collab-projection.ts`／`collab-client.ts`、`useCollab.ts`、`CollabPanel.tsx`
- 配布：`src-tauri/tauri.bundle.conf.json`、`scripts/stage-node.mjs`、`release.yml`
- 開発メモリ：[[collab_host_model]]、関連 [[ai_integration_architecture]]・[[p1_mcp_server_design]]・[[product_form_desktop]]・[[primary_surface_deck]]
