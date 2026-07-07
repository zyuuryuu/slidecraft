# 変更履歴

SlideCraft の主要な変更点です。形式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/)、
バージョニングは [Semantic Versioning](https://semver.org/lang/ja/) に従います（**0.x 系は早期版＝MINOR でも破壊的変更があり得ます**）。

- 完全な変更履歴：[CHANGELOG.md](https://github.com/zyuuryuu/slidecraft/blob/main/CHANGELOG.md)
- 出荷済み機能の網羅ログ：[shipped.md](https://github.com/zyuuryuu/slidecraft/blob/main/docs/shipped.md)

## [Unreleased]

### 追加

- **`.scft` をアプリに関連付け（ダブルクリックで開く）** — プロジェクトファイル（`.scft`）を**ダブルクリック / 「プログラムから開く」**で SlideCraft が起動して開くように。起動済みなら**新しいタブ**として開き、いま開いているものは壊しません。
- **AI が Live MCP で作ったデッキを GUI の背景タブに出す** — 協働中に上流 AI が新しいデッキを作ると、GUI に背景タブとして現れます（表示は切り替わりません）。

### 変更

- **プロジェクトファイルの拡張子を `.slidecraft` → `.scft` に短縮** — 短く扱いやすい 4 文字に。

## [0.2.0] — 2026-07-07

第三者スライドマスター対応と、上流 AI 向け MCP CLI 同梱が目玉。

### 追加

- **MCP サーバをアプリに同梱** — 配布インストーラに自己完結した MCP サーバと Node ランタイムを同梱。上流 AI（Claude Code / Cursor / Claude Desktop）から**ソースのビルドもシステム Node も不要**で SlideCraft を駆動できるように。macOS は Homebrew が `slidecraft-mcp` を PATH に登録（`claude mcp add slidecraft -- slidecraft-mcp`）。詳細は [MCP ガイド](/guide/mcp)。
- **スライドマスター Re-make（テーマだけ取り込む）** — 会社テンプレのフォント・配色・背景・ロゴだけ受け継いで SlideCraft 自前レイアウトで作り直す第2の取り込み口。忠実取り込みと両立。詳細は [テンプレート](/guide/templates)。
- **プレビューでスライドマスターのロゴ・図版を描画** — 従来落ちていたテンプレのロゴがプレビュー/HTML に出るように。

## [0.1.0] — 2026-07-07

初回パブリックリリース（早期版）。

### 追加

- Markdown/YAML → PPTX 変換（テンプレート placeholder 埋め・native OOXML 生成）
- 視覚エディタ（deck = 単一の真実）＋[二段階編集](/guide/editing-and-export)（内容＝Markdown／デザイン＝空間意図→座標）
- [図](/guide/diagrams)：ネイティブ **12 種**（` ```diagram `）＋ Mermaid 経由の class/state/ER/mindmap・GFM 表・コード・画像（自己完結 data URI）
- スタンダロン HTML 出力／PPTX native-vector export
- [内蔵オフライン AI](/guide/ai-setup)（llamafile 同梱・環境適応モデルティア）＋AI 編集の採用ゲート
- [テンプレート](/guide/templates)作成・取込・修復（作成モーダルのライブプレビュー／レイアウトサブセット／カスタムレイアウト）
- 協働ホスト（[MCP](/guide/mcp)）：上流 AI が Tools で編集し GUI がライブ反映

### 注意

::: warning macOS
ad-hoc 署名（未ノータライズ）。**Apple Silicon での起動は確認済み**。新しめの macOS（15 Sequoia 以降）では
初回に未ノータライズ警告が出るため、**システム設定 → プライバシーとセキュリティ →「このまま開く」**で開いてください
（右クリック→「開く」だけでは通らない場合があります）。Intel Mac 版は未提供。不具合は [Issue](/guide/reporting-issues) で歓迎します。
:::

更新は当面**手動**です（macOS は将来 Homebrew cask 予定）。詳細は
[リリース手順](https://github.com/zyuuryuu/slidecraft/blob/main/RELEASING.md)。
