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
| [0013](0013-svg-native-text.md) | 図テキストを SVG `<text>` に統一（foreignObject 廃止・印刷/canvas 堅牢化・shrink=PPTX fit 準拠） | Accepted |
| [0014](0014-template-authoring.md) | テンプレ作成補助（修復オファー・ゼロから生成・AI はスペック提案のみ・レジストリ永続化） | Accepted |
| [0015](0015-mcp-brushup.md) | MCP ブラッシュアップ（**手前半優先**：オーサリング契約露出＋テンプレ discovery／統一 mutation envelope・構造操作 4 tool・`get_slide`） | Accepted（実装 S1–S6） |
| [0016](0016-security-review-theme4.md) | セキュリティレビュー テーマ4（5 サーフェス全面監査・ADR-0010 補追：既定 egress を絞り custom は opt-in・svgCache 不信＋エクスポート CSP） | Accepted（監査完了・是正はバックログ） |
| [0017](0017-inapp-offline-ai-runtime.md) | 内蔵オフライン AI ランタイム＋環境適応モデルティア（同梱 llamafile sidecar・RAM/cores で phi-3.5⇄granite-4.1-8b・pinned GGUF auto-DL・env-free 配布） | Accepted（Windows/Linux 実機検証・mac 署名は CI 待ち） |
| [0018](0018-validation-at-adoption-gate.md) | AI 編集の検証は採用ゲートに（描画は止めない・ADR-0012 補追：`reconcileSlideEdit` が採用前に reconciled 結果＋warnings を提示・採用済みは常に描画） | Accepted |
| [0029](0029-cover-subtitle-role-recovery.md) | 表紙 subtitle の gated リカバリ（ADR-0025 の subtitle 版・rung は idx 規約のみ＝幾何は ADR-0023 の第三者マスタ契約を壊すため不採用） | Accepted |
