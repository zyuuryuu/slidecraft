# Architecture Decision Records (ADR)

SlideCraft の **決定済み＆実装済み**アーキテクチャ決定の記録。各 ADR は `Context / Decision / Consequences / References`。

- 新しい決定は番号を増やして追加する。ADR は原則 **immutable**（覆す場合は新 ADR で supersede し、古い方の Status を `Superseded` にする）。
- 前方向きの計画は [../ROADMAP.md](../ROADMAP.md)、詳細設計は [../design/](../design/)、MCP の使い方は [../mcp-server.md](../mcp-server.md)。

| # | 決定 | Status |
|---|------|--------|
| [0001](0001-product-form-desktop.md) | プロダクト形態＝Tauri デスクトップアプリ（browser=dev・dual-mode IPC） | Accepted |
| [0002](0002-primary-surface-deck.md) | 主面＝視覚 deck（deck=唯一の源・Markdown は入出力のみ） | Accepted |
| [0003](0003-diagram-pipeline.md) | 図パイプライン＝DiagramSpec 正典＋共有 painter（WYSIWYG・native・画像ゼロ） | Accepted |
| [0004](0004-ooxml-style-hierarchy.md) | OOXML スタイル階層＝lstStyle は差分のみ | Accepted |
| [0005](0005-harness-over-model.md) | harness-over-model ＋ 自動修復ループ（distill/refine） | Accepted |
| [0006](0006-ai-integration-architecture.md) | AI 統合＝Core+Adapters・headless MCP 先行・OS ユーザ=信頼 | Accepted |
| [0007](0007-mcp-server-design.md) | MCP サーバ設計（決定論レバー・native-only export・--no-fs） | Accepted |
| [0008](0008-mcp-tool-surface.md) | MCP ツール/リソース面（監査結論：reads は二重提供・generate_from_plan=作らない） | Accepted |
| [0009](0009-p2-collab-host.md) | P2 協働ホストモデル（sidecar=真実・multi-doc・server-undo・双方向・配布） | Accepted |
| [0010](0010-security-model.md) | セキュリティモデル（token=境界・loopback・no-fs/scoped・zip 硬化） | Accepted |
| [0011](0011-placeholder-input-bijection.md) | プレースホルダ⇄入力＝検証済み全単射（役割バインドはレンダー1境界に封じる） | Accepted |
| [0012](0012-ai-edit-structure-preservation.md) | AI 編集の構造保全ハーネス（reconcile+validate を全経路・正準規約は単一の源） | Accepted |
