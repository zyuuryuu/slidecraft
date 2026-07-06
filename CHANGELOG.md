# Changelog

このプロジェクトの主要な変更点を記録します。形式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/)、
バージョニングは [Semantic Versioning](https://semver.org/lang/ja/) に従います（**0.x 系は早期版＝MINOR でも破壊的変更があり得る**）。

出荷済み機能の網羅的な履歴は [docs/shipped.md](docs/shipped.md)、決定の記録は [docs/adr/](docs/adr/) を参照。

## [Unreleased]

初回パブリックリリース **v0.1.0** を準備中（[docs/ROADMAP.md](docs/ROADMAP.md) の「初回リリース マイルストーン」）。
リリース時に本セクションを `## [0.1.0] - YYYY-MM-DD` へ移し、新しい空の Unreleased を作る。

### Added

- Markdown/YAML → PPTX 変換（テンプレート placeholder 埋め・native OOXML 生成）
- 視覚エディタ（deck = 単一の真実）＋二段階編集（内容＝Markdown／デザイン＝空間意図→座標）
- 14 種の図（native 12＋mermaid 経由 2）・GFM 表・コード・画像（自己完結 data URI）
- スタンダロン HTML 出力／PPTX native-vector export
- 内蔵オフライン AI（llamafile 同梱・環境適応モデルティア）＋AI 編集の採用ゲート
- テンプレ作成・取込・修復（作成モーダルのライブプレビュー／レイアウトサブセット／カスタムレイアウト）
- 協働ホスト（MCP）：上流 AI が Tools で編集し GUI がライブ反映
- 詳細は [docs/shipped.md](docs/shipped.md)
