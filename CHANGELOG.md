# Changelog

このプロジェクトの主要な変更点を記録します。形式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/)、
バージョニングは [Semantic Versioning](https://semver.org/lang/ja/) に従います（**0.x 系は早期版＝MINOR でも破壊的変更があり得る**）。

出荷済み機能の網羅的な履歴は [docs/shipped.md](docs/shipped.md)、決定の記録は [docs/adr/](docs/adr/) を参照。

## [Unreleased]

（次リリースの変更をここに追記）

## [0.1.0] - 2026-07-07

初回パブリックリリース（**早期版** — 0.x のため MINOR でも破壊的変更があり得ます）。

### Added

- Markdown/YAML → PPTX 変換（テンプレート placeholder 埋め・native OOXML 生成）
- 視覚エディタ（deck = 単一の真実）＋二段階編集（内容＝Markdown／デザイン＝空間意図→座標）
- 図：ネイティブ **12 種**（` ```diagram `）＋ mermaid 経由の class/state/ER/mindmap・GFM 表・コード・画像（自己完結 data URI）
- スタンダロン HTML 出力／PPTX native-vector export
- 内蔵オフライン AI（llamafile 同梱・環境適応モデルティア）＋AI 編集の採用ゲート
- テンプレ作成・取込・修復（作成モーダルのライブプレビュー／レイアウトサブセット／カスタムレイアウト）
- 協働ホスト（MCP）：上流 AI が Tools で編集し GUI がライブ反映
- 詳細は [docs/shipped.md](docs/shipped.md)、使い方は [ユーザーガイド](docs/user-guide.md)

### Notes

- **macOS**: ad-hoc 署名（未ノータライズ・本ビルドは実機未検証）。初回起動は Finder で右クリック →「開く」、
  または `xattr -dr com.apple.quarantine /Applications/SlideCraft.app`。不具合は Issue で歓迎します。
- 更新は当面**手動**（macOS は将来 Homebrew cask 予定）— [RELEASING.md](RELEASING.md) / [ADR-0021](docs/adr/0021-auto-update-strategy.md)。
