# Changelog

このプロジェクトの主要な変更点を記録します。形式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/)、
バージョニングは [Semantic Versioning](https://semver.org/lang/ja/) に従います（**0.x 系は早期版＝MINOR でも破壊的変更があり得る**）。

出荷済み機能の網羅的な履歴は [docs/shipped.md](docs/shipped.md)、決定の記録は [docs/adr/](docs/adr/) を参照。

## [Unreleased]

## [0.2.1] - 2026-07-07

早期版（0.x）。**UI の日英切替（i18n）と英語ドキュメント**、**`.scft` ファイル関連付け**、**プレビュー/HTML 描画の忠実化**が目玉。

### Added

- **UI の日英切替（i18n）** — 画面右上のトグルで UI 全体を日本語⇄英語に切り替え（react-i18next・選択は記憶）。全コンポーネントに加え、フック/モジュール由来の状態・通知文言（接続ステータス「接続OK」等）まで翻訳済み。
- **英語ドキュメント** — ドキュメントサイトに英語版ユーザーガイドを追加（ナビ右上の言語スイッチャで日⇄英を切替）。README・第三者通知（THIRD-PARTY-NOTICES）も英訳し、GitHub 上で言語リンクを相互往来。
- **`.scft` をアプリに関連付け（ダブルクリックで開く）**（ADR-0024）— プロジェクトファイルを**ダブルクリック / 「プログラムから開く」**で SlideCraft が起動して開く。起動済みなら**新しいタブ**として開き、現在の作業を壊さない。Windows/Linux はウォーム起動（起動中にもう 1 つ開く）も `single-instance` で単一ウィンドウに集約、macOS は Apple の open イベント、Windows/Linux コールドは argv で受ける。
- **AI が Live MCP で作った Deck を GUI の背景タブに出す**（モード b）— 協働接続中に上流 AI が `new_project` で新しいデッキを作ると GUI に**背景タブ**として現れる（表示は切り替えない）。以前はタブが増えず見えなかった。
- **公式ビルトインテンプレートを 4 本に** — 「配布資料 公文書高密度／ビジュアルデッキ マガジン／技術報告 スタンダード水色」を追加（従来の Midnight Executive に加え、起動時に選択可能）。
- **プレビュー/HTML の描画忠実度を向上** — スライドマスター/レイアウトの**背景画像・グラデーション**、**グループ図形**（座標変換）、**custGeom の弧**、テンプレの**図形（楕円・矢印・カスタム幾何）**を描画。共有エンジン由来のため PPTX/プレビュー/HTML が一致。
- **空の状態で起動** — 起動時に読み込んでいた既定サンプル Markdown を廃止し、空から始められるように。

### Changed

- **プロジェクトファイルの拡張子を `.slidecraft` → `.scft` に短縮**（ADR-0024）— 4 文字の慣用的レンジへ。初回リリース直後で野良ファイルが無い今のうちに改名。保存名・ピッカー・起動時オープンは単一定数（`PROJECT_EXT`）を参照。
- 開発ツール `esbuild` を 0.28.1 に更新（devDependency のみ・出荷アプリ / dev サーバには非含有）。

### Fixed

- **空のデッキで「＋ スライド追加」が効かない不具合**を修正（デッキが無い状態でも 1 枚目を作成する）。
- **協働ホストで AI が作った Deck のタブ名が常に「Untitled」になる不具合**を修正（先頭スライドの見出しから命名・B4）。

## [0.2.0] - 2026-07-07

早期版（0.x）。**第三者スライドマスター対応**と、上流 AI 向けの **MCP CLI 同梱**が目玉。

### Added

- **MCP サーバをアプリに同梱**（ADR-0022）— 配布インストーラに自己完結した MCP サーバ（`cli.cjs`）と Node ランタイムを同梱。上流 AI（Claude Code / Cursor / Claude Desktop）から **ソースのビルドもシステム Node も不要**で SlideCraft を駆動できる。macOS は Homebrew cask が `slidecraft-mcp` を PATH に登録（`claude mcp add slidecraft -- slidecraft-mcp`）。Windows/Linux は同梱 node ＋ `cli.cjs` を直接登録（正確なパスはインストール先を要確認・現状未検証）。
- **スライドマスター Re-make（テーマだけ取り込む）**（ADR-0023）— 実マスターの構造を忠実に活かす従来の「取り込み」に加え、**フォント・配色・背景・ロゴだけ抽出して SlideCraft 自前レイアウトで作り直す**第2の取り込み口を追加（両方の口を提供）。第三者マスターの idx/テーマの癖を構造的に回避。ロゴ継承、フラット設計（ヘッダーバー有無）の吸収、コントラスト安全な配色マッピング付き。
- **プレビュー/HTML でスライドマスターのロゴ・図版（`<p:pic>`）を描画** — 従来はレイアウト/マスターの画像をプレビューで落としていたのを data-URI として描画。忠実取り込みでも会社ロゴが見えるように。

### Fixed

- **反転テーマのマスターでプレビュー背景が暗転する不具合を修正** — テーマを反転させたマスター（例: `clrMap bg1→lt1=濃紺`／実マスター背景は `bg2→lt2=白`）で、プレビュー/HTML の背景を `themeColors.bg1` から導いていたため、マスター背景を継承する本文スライドが濃紺で描画され本文が読めなくなっていた（PPTX は白で正しい）。マスターの実際の `<p:bg>` を読むよう修正。
- **素の第三者スライドマスターで本文が入らない不具合を修正**（ADR-0023）— 知財情報を剥がした実テンプレート（本文 placeholder が idx 10 以降）で、SlideCraft 内部の idx-META 規約（idx 10/11/12/15/16 を META とみなす）が本文を誤って META と解釈し、content レイアウトの本文が空になっていた。規約を「自前マスター（canonical ドット名 or 型付き sldNum/dt/ftr メタ）」だけに限定し、素のマスターでは idx 10 以降の body を本文として束縛。プレビュー・PPTX 出力とも追随するように。
- `update-cask.mjs` が arm64-only（sha256 1 行）のテンプレートで失敗する潜在バグを是正（1〜2 行を許容）。

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
