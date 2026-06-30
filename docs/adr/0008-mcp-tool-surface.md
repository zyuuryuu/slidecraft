# ADR-0008: MCP ツール/リソース面（監査結論）

- **Status**: Accepted
- **Date**: 2026-06（6エージェント監査 2026-06-29、PR #25 で出荷）

## Context
`slidecraft serve` の MCP 面（18 ツール + 6 リソース）が肥大化していないか、重複・冗長がないかを 6 エージェント監査（4レンズ: MCP-idiom / agent-ergonomics / harness-over-model / client-compat → 統合 → 敵対的検証）で精査した。論点は主に次の 3 つ。
- `get_*` 読み取りツール（6個）と `deck://` / `slide://` リソース（6個）が同じ状態を二重に露出している — de-dup すべきか。
- DeckPlan から直接生成する `generate_from_plan` を新設すべきか。
- 変更系ツール（`set_slide_markdown` vs `set_deck_markdown`、`set_slide_diagram` vs `apply_design_intent`、`validate_deck` vs `get_deck_issues`）に実質的な重複があるか。

## Decision
監査結論は **構造的重複ゼロ → 削除・統合ゼロ**。具体的に確定した判断:
- **読み取りは意図的なデュアル面 — `get_*` ツールを削除しない**。`tools/call` は唯一すべてのクライアントで自律的にサポートされる読み取り経路で、リソース対応はクライアント差が大きい。読み取りツールを消すと「変更はできるが deck を SEE できない」エージェントが生まれ、プロトコル層の never-silent 違反になる。各 `get_*` は対応リソースの「互換性フロアのミラー」として位置づける（`server.ts` の説明文に明記済み）。
- **`generate_from_plan` = DO-NOT-BUILD**。DeckPlan はエージェントが既に著作するコンテンツなので、Markdown として `new_project` に直列化する。`new_project` は GUI の Draft と同じ parseMd→distillDeck 整形を通し、かつ `autoSelectLayout` でレイアウトを再解決する（任意テンプレで動く）。スタンドアロン経路 `slidePlanToSlide` は canonical レイアウト名をハードコードしており alien-unsafe な冗長 create-door になる。
- **変更系ツールは実質的に別物（統合しない）**: `set_slide_markdown`（図/mermaid を自動保持・1スライド）vs `set_deck_markdown`（deck 全体・図は保持されない）; `set_slide_diagram`（図に【何を】置くか）vs `apply_design_intent`（図を【どう配置するか】）; `validate_deck`（EXPORT ゲート）vs `get_deck_issues`（CONTENT レバー）。唯一の欠点は名前の紛らわしさで、説明文の明確化で対処した。
- **本文 budget を `get_deck_issues` / `deck://issues` に同梱**（contentBodyBox 由来の maxBullets / charsPerBullet）。溢れ修正が `get_slide_fix_request` を別途叩かずに修正対象を見られるようにした。

## Consequences
- 18 ツール + 6 リソースの面を維持。最小・直交した面を保ったまま、クライアント互換性のフロアを確保する。
- **do-NOT-undo ガードレール**: ①読み取りツール群を「重複だから」と削除しない、②`generate_from_plan` / `slidePlanToSlide` 経路を新設しない（任意テンプレ保証を壊す）、③上記の変更系ペアを統合しない。
- harness-over-model 原則と整合: 決定論レバー（split / table 化 / design intent）はエンジン側に置き、サーバはモデルを呼ばない。
- **Deferred（任意・クライアント差あり）**: `get_slide_fix_request` を MCP prompt としても露出する案（現状サーバは prompt をゼロ登録）。追加のみで、ツールを canonical のまま残す。

## References
- 設計: `docs/mcp-server.md`、`docs/design/p2-collab-design.md`
- コード: `src/mcp/server.ts`（18 ツール登録 + doc 解決 + mutate/commit）、`src/mcp/resources.ts`（`deck://*` / `slide://{index}/markdown` リソース）、`src/mcp/session.ts`（エンジンハンドラ）、`src/engine/` の `autoSelectLayout` / `slidePlanToSlide`
- 開発メモリ: `mcp_surface_audit` · 関連 `p1_mcp_server_design` · `guardrail_any_template` · `tool_role_last_mile` · `product_philosophy_harness`
