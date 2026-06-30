# ADR-0007: MCP サーバ設計（決定論レバー・native-only export）

- **Status**: Accepted
- **Date**: 2026-06（P1 設計探索＋3案収束で決定）

## Context
上流の AI エージェント（Claude Desktop / Claude Code 等）から SlideCraft を駆動したい。ただし WSL2 の GUI 問題と無関係に動く headless 経路が要る一方、エージェント自身が LLM なので、サーバ側でモデルを呼ぶのは二重知能になり無駄。SlideCraft の価値は「レイアウト解決・分割・容量検証・テンプレ準拠の PPTX 生成」という**決定論エンジン**側にある（harness-over-model）。よって公開すべきは「賢い生成」ではなく「賢い決定論操作」。加えて、Rust 側 lib.rs の任意 fs 穴（[[security_present_holes]]）を Node サーバに持ち込まない信頼境界設計が必要だった。

## Decision
- **形**: resource-centric な headless **stdio MCP サーバ**（`slidecraft serve` / `dist/mcp/cli.js`）。Node プロセスが**純粋 TS engine（`src/engine/*`）のみを直 import** する（`src/ipc`・`src/components` は import しない＝DOM/Tauri 非依存、R2/R5 ゴールデン面と分離）。1 stdio session = 1 active project（`session.ts` の `Session`）。
- **エージェント＝LLM**: サーバは LLM を呼ばない。公開ツール（18 個）は全て**決定論的 engine 操作**: open/new、各種 read、`set_slide_markdown`/`set_deck_markdown`、決定論レバー `split_overflowing_slides`（フォント縮小なし分割＝distillDeck）と `convert_bullets_to_table`（key-value→GFM 表）、`set_slide_diagram`/`apply_design_intent`（two-stage editing の content/design）、`validate_deck`、`save_project`、`export_pptx`。文章修正は inverted aiFix: `get_slide_fix_request(i)` が制約＋診断の packet を返し、**エージェントが Markdown を埋めて** `set_slide_markdown` で適用する。
- **読み取りの二重提供**: deck 状態を MCP **resources**（`deck://current|markdown|issues|capabilities|info`、`slide://{i}/markdown`）としても公開。resource 対応クライアントは resource、非対応・人手添付のみのクライアントは同等の read ツールが確実な経路。**どちらも削らない**。
- **native-vector-only headless export**: `export_pptx` は `generatePptx` をラスタライザ無しで呼び、14 種ネイティブ図＋表を**編集可能 PPTX シェイプ**として出す（新 heavy dep なし）。**変換不能 Mermaid（gitGraph/sankey/C4 等）は headless では描けず無言消失する**ため、既定 `onUnsupportedMermaid:"reject"`（精密エラー）、`"skip"` で当該スライド省略＋`skipped` 報告。`validate_deck` の `exportReadiness`（native-ok / blocked）で事前検出。**never-silent**。
- **fs / 信頼境界**: v1 は **`--no-fs` のみ**（base64 over stdio、サーバはファイルに触れない＝信頼境界は spawn した親エージェント＝OS ユーザ）。`cli.ts` は `--root`（scoped fs）を現状 exit(2) で拒否し、将来版に予約。
- **generate_from_plan は作らない**: DeckPlan はエージェントが既に書ける内容で、Markdown 化して `new_project` に渡せば同じ整形パス（parseMd→distillDeck→autoSelectLayout）で**任意テンプレに解決**される。`slidePlanToSlide` のレイアウト名ハードコード（alien テンプレに弱い・[[guardrail_any_template]]）を回避するため、別コードパスを増やさない。

## Consequences
- エンジンが正しいレイアウト・フォント維持・テンプレ準拠を保証するので、エージェントは**内容に集中**できる。tool 結果は常に diagnostics を返すため、通知無視でも正しいループになる。
- **do-NOT-undo**: ①決定論レバー（split/convert）は v1 必須要素＝harness-over-model の肝。v2 先送り禁止。 ②export の Mermaid 無言消失は禁止（reject 既定を弱体化しない）。 ③`get_slide_fix_request` の inverted 構造を「サーバ側で LLM を呼ぶ」方向へ反転させない。 ④read ツールと `deck://` resource の二重提供は意図的、削らない。
- **egress 2 境界の分離**: (A) GUI→LLM は「ローカルモデル限定モード」が統治、(B) agent→MCP のモデルは統治外（エージェントに**接続すること自体が opt-in egress**）。この 2 つを混同しない。
- 既に P2 の collab `host` モード（`server.ts`: multi-doc DocRegistry＋サーバ側 undo/redo＋楽観的並行性 rev）が同じ 18 tool を共有する形で実装済み。stdio はその `host` 無しの正ベースライン。
- 残課題: `--root` の安全な実装（resolveInRoot 単一 chokepoint: NFC 正規化・親 dir realpath・O_NOFOLLOW・拡張子 case-fold allowlist）、Node ラスタライザ（resvg-js＋CJK フォント）は P2。配布形態（local-path 登録 vs npm publish）は未決。

## References
- 設計ドキュメント: `docs/mcp-server.md`
- コード: `src/mcp/cli.ts`（`slidecraft serve` エントリ・`--no-fs`）、`src/mcp/server.ts`（18 tool 登録・resources・host モード）、`src/mcp/session.ts`（純粋 engine セッション）、`src/mcp/resources.ts`、`src/mcp/host-core.ts`
- 参照 engine: `src/engine/{distill,deck-diagnostics,slide-rewrite,slide-fix,design-intent,placeholder-filler,mermaid-to-diagram}.ts`
- 開発メモリ: `p1_mcp_server_design`、関連 `ai_integration_architecture` / `product_philosophy_harness` / `guardrail_any_template` / `security_present_holes`
