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
| [0007](0007-mcp-server-design.md) | MCP サーバ設計（決定論レバー・native-only export・--no-fs） | Accepted（stdio 単一管制は [0033](0033-mcp-single-control-plane.md) で部分 supersede・他は存続） |
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
| [0019](0019-partial-edit-ops.md) | AI 単一スライド編集は「構造化編集 ops → 決定論マージ」（部分生成・変更フィールドのみ出力し drift を源で断つ・弱モデルは全文フォールバック温存・自己修復リトライ＋best-of-N を段階実装） | Accepted |
| [0020](0020-image-embedding.md) | 画像埋め込みは data URI 埋め込み（Markdown `![alt](src)` → SlideIR image ブロック・PPTX は media 抽出＋`<p:pic>`・ペースト/D&D で挿入） | Accepted |
| [0021](0021-auto-update-strategy.md) | 自動更新の初回戦略＝軽量通知・完全署名 Updater は保留（v0.1.0 は macOS=brew upgrade／Windows・Linux=手動再DL・署名鍵の回転不能性を初回で背負わない） | Accepted（2026-07-07） |
| [0022](0022-bundle-mcp-cli.md) | MCP CLI をアプリに同梱（ビルド不要のエージェント駆動・`build:mcp:bundled` で全依存内包バンドル＋macOS PATH ランチャ・v0.2.0 以降で有効） | Accepted（bundle 内容を [0033](0033-mcp-single-control-plane.md) で更新＝host サーバ＋stdio アダプタ） |
| [0023](0023-third-party-master-idx-convention.md) | 素の第三者マスターでの idx-META 規約の適用可否（自前規約に従うマスターだけに idx-META 分岐をゲート・`usesMetaIdxConvention` が構造シグナルで判定・CX Sample 等の本文誤分類を解消） | Accepted |
| [0024](0024-scft-file-association.md) | `.scft` 拡張子への短縮とアプリ関連付け（ダブルクリックで開く・OS 起動パスは Rust が fs スコープ許可の上で queue→webview が drain・single-instance で二重起動を防止） | Accepted |
| [0025](0025-placeholder-role-resolution.md) | Placeholder のロール解決＝明示ラダー＋gate 付き title リカバリ（type/idx-meta/body が絶対な上で、layout に title が皆無の時だけ name＋idx0/geometry の合議で title 昇格・健全テンプレは byte-identical） | Accepted |
| [0026](0026-ai-remake.md) | AI 非決定 Re-make（第3の取り込み口・構造マッピング＝AI は分類器のみで各レイアウトを canonical へ写像し幾何/装飾は canonical 側から取る・never-worse で決定論 Re-make にフォールバック） | Superseded by [ADR-0028](0028-retire-ai-remake-option-c.md)（option C は撤去。理由は ADR-0028 参照） |
| [0027](0027-remake-source-visual-preservation.md) | Re-make v2＝ソース視覚層の保持＋幾何ベース Placeholder 識別（装飾・背景・幾何はソースを保持しフォントのみ正規化・幾何ベースのロール識別を土台に強化・ADR-0026 の canonical 写像部分を部分 supersede） | Accepted |
| [0028](0028-retire-ai-remake-option-c.md) | AI Re-make（option C）の撤去（faithful Re-make と決定論 Re-make で用途を満たすため導線ごと削除・AI の再登場は parse-audit で決定論の失敗が実証された時のデータ駆動） | Accepted |
| [0029](0029-cover-subtitle-role-recovery.md) | 表紙 subtitle の gated リカバリ（ADR-0025 の subtitle 版・rung は idx 規約のみ＝幾何は ADR-0023 の第三者マスタ契約を壊すため不採用） | Accepted |
| [0030](0030-binding-plan-single-authority.md) | BindingPlan＝束縛の単一 authority（`resolveBinding`/`slideBindingPlan` で観測合成・段階的 A–E・段階A は byte-identical＋診断のみ増える＝#97/#135/#128 の silent-drop を surface） | Accepted（段階A–B 実装済） |
| [0031](0031-maintainability-gates.md) | 保守性ゲート＝構造規約の実行可能化（G1: 権威/R1/R2/循環を arch-conformance テストで CI 必須化・ratchet 運用／G2: 意味の重複には一致テスト必須＝R8／G3: 傾向センサスは fail させない・複雑度ゲートやカバレッジ%目標は不採用） | Accepted |
| [0032](0032-authoring-notes-and-sections.md) | authoring 記法拡張＝`<!-- note -->` ノートマーカー＋`<!-- section -->` 章タグ（章扉は生成でなく著者スライド＝ADR-0002/0030 との衝突回避・目次は `<!-- toc -->` 導出専用で複製状態を持たない=R8・新記法なし md は byte-identical） | Accepted |
| [0033](0033-mcp-single-control-plane.md) | MCP の単一管制（口=薄い transport アダプタは複数可・管制=deck 権威/`commitMutation`/undo/doc lifecycle は単一）。stdio 専用管制（単独 Session 経路）を廃止し host の管制に合流・非対称解消（D1）／client 側も 1エンドポイント adaptive front へ（D2・後続）／北極星＝GUI `ai-apply` も同一管制へ | Accepted（D1 実装予定・D2 計画） |
