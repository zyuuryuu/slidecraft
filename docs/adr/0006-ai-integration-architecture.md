# ADR-0006: AI 統合＝Core+Adapters・headless MCP 先行・OS ユーザ=信頼

- **Status**: Accepted
- **Date**: 2026-06（13 エージェント設計探索＋ユーザ確定。stdio MCP・ローカル限定モード・Rust 硬化は実装済み）

## Context
上流 AI（Claude Desktop / Claude Code 等）が SlideCraft をローカルで駆動する統合をどう設計するか。論点は3つ。
- **トランスポート**: GUI 単体だけでなく、agent が叩ける口をどう増やすか（毎回コアを作り直さないか）。
- **認証**: 送信元をどう信頼するか。同一 uid プロセスは 0600 トークンも `/proc/<pid>/environ` も読め、peer-cred は TCP で無効 → トークン三層は同一 uid に対して無力な「儀式」。
- **漏洩**: 真のリークは配線ではなく **egress**（DeckIR 丸ごとを上流 AI / クラウドモデルに渡すこと）。

## Decision
- **Core+Adapters** を採る。**Core** = 純粋エンジン（`src/engine/*`）＋共有 State ストア＋既存契約（`refineDeck(aiFix)` / `deckPlanToDeck` / DeckIR in-out）。ロードマップ stage D の「再公開」であり作り直しではない。
- **Adapter として headless stdio MCP を先行実装**（`slidecraft serve`, `src/mcp/`）。Node が純粋 TS engine を直 import（Rust 不要、`src/ipc`・`components` は import しない）。resource-centric: 読み取りは `deck://…` / `slide://{i}/markdown` リソース、変更は Tools。上流 agent が LLM＝サーバは LLM を呼ばない（inverted aiFix: agent が `get_slide_fix_request` の packet を埋め `set_slide_markdown` で適用）。決定論レバー（`split_overflowing_slides` / `convert_bullets_to_table`）を v1 で公開＝harness-over-model の肝。
- **送信元認証は作らない**: OS ユーザ＝信頼境界。stdio path はネットワークリスナーを置かず、v1 は `--no-fs` のみ（.slidecraft / .pptx を base64 で stdio に流す＝サーバはファイルを読み書きしない）。`--root`（scoped fs）は次バージョン予約。
- **ローカルモデル限定モード**（GUI）を用意。クラウド送信は明示 opt-in。ハード egress ブロックは全生成経路が通る単一チョークポイント `generateWithAI`（`src/ipc/ai.ts`）で `isLocalTarget()` により実施（UI ガードを迂回する submit/submitAndWait も塞ぐ）。

## Consequences
- マルチプロジェクト/認証/egress を「コアで一度」解くので transport を増やしても再実装しない。stdio 先行は協調の北極星を捨てず最短路：ファイル媒介協調は P1 で成立し、P2 のライブ協調（GUI ホスト型 attach, `src/mcp/host.ts`）が共有コア上で作り直しゼロで載った。
- P2 host-attach は loopback HTTP のため stdio と異なり **bearer token + Origin allowlist** で gate するが、**OS ユーザは依然トラスト境界**（同一 uid マルウェアは明示的に scope 外。token は POSIX で 0600）。
- desktop の CORS は Rust 経由（tauri-plugin-http + `src/ipc/app-fetch.ts`）で webview origin を消して回避済み。CSP は `csp:null` を脱し `default-src 'self'` ＋ `connect-src` 明示（localhost:11434＋3クラウド API＋ipc）。lib.rs の任意 path read/write は scoped tauri-plugin-fs へ移行済み。
- **do-NOT-undo ガードレール**: (1) stdio path にネットワークリスナー/認証トークンを足さない。(2) egress 2 境界を混同しない＝(A) GUI→LLM はローカル限定トグルが統治、(B) agent→MCP のモデルは統治外（attach 自体が opt-in egress）。(3) MCP は生 fs を公開せず engine 契約のみ。(4) export は native-vector-only headless、変換不能 mermaid（gitGraph/sankey/C4）は無言消失させず reject/skip。

## References
- 設計: `docs/mcp-server.md`, `docs/design/p2-collab-design.md`, `docs/ROADMAP.md`
- コード: `src/mcp/server.ts`・`cli.ts`・`host.ts`・`host-security.ts`, `src/engine/refine.ts`, `src/ipc/ai.ts`（`generateWithAI` / `isLocalTarget`）, `src/ipc/app-fetch.ts`, `src/components/useAiGeneration.ts`, `src-tauri/tauri.conf.json`（CSP）, `src-tauri/src/lib.rs`（plugin-fs）
- 開発メモリ: `ai_integration_architecture`, `ai_integration_state`, `p1_mcp_server_design`, `security_present_holes`, `product_philosophy_harness`, `guardrail_any_template`
