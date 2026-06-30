# SlideCraft

Markdown で書いたスライドを会社テンプレート PPTX に流し込むデスクトップアプリ。
LLM が Markdown を書き、人間が WYSIWYG プレビューで確認・PPTX を生成するワークフローを想定。

Tauri v2 + React + TypeScript + JSZip で構築。

## 機能

- **Markdown → PPTX** — Markdown を書くだけでテンプレート PPTX のプレースホルダーにテキストを流し込み
- **WYSIWYG プレビュー** — テンプレートの装飾・色・フォントを反映したスライドプレビュー
- **30種レイアウト** — タイトル / セクション / コンテンツ / カラム / KPI / チャート / 比較 / プロセス等
- **テンプレート読み込み** — 既存の .pptx テンプレートを読み込んでスタイルを適用
- **ダイアグラムモード** — YAML/JSON でフローチャート・スイムレーンを PPTX 出力 (PptxGenJS)
- **クロスプラットフォーム** — Windows (.msi) / macOS (.dmg) / Linux (.AppImage, .deb)
- **AI エージェント連携 (MCP)** — 上流の AI から SlideCraft を駆動する headless な stdio MCP
  サーバ `slidecraft serve`。接続方法・ツール一覧・使い方は [docs/mcp-server.md](docs/mcp-server.md) を参照

## セットアップ

### 前提条件

- Node.js 20+
- Rust 1.70+ (Tauri ビルド用)
- Linux の場合: `libgtk-3-dev`, `libwebkit2gtk-4.1-dev`, `librsvg2-dev`, `libssl-dev`, `patchelf`

### インストール

```bash
git clone git@github.com:zyuuryuu/slidecraft.git
cd slidecraft
npm install
```

## 開発

```bash
npm run dev          # Vite dev server (localhost:5173)
npm run tauri dev    # Tauri + Vite 同時起動
```

## テスト

```bash
npm test             # ユニットテスト (Vitest, 402 tests)
npm run test:e2e     # E2E テスト (Playwright, 6 tests)
npm run lint         # ESLint
```

## ビルド

```bash
npm run build        # フロントエンドビルド (tsc + vite)
npm run tauri build  # インストーラ生成
```

## プロジェクト構成

```text
src/
  engine/            # 純粋ロジック (DOM/Tauri API 依存なし)
    schema.ts        # Zod スキーマ定義
    theme.ts         # テーマ設定・YAML パーサー
    layout-engine.ts # ダイアグラムレイアウト計算
    diagram-painter.ts # 共有 painter (プレビュー SVG ＝ PPTX ネイティブ図形)
    diagram-icons.ts # ノードアイコン (ネイティブグリフ)
    placeholder-filler.ts # Markdown→PPTX テンプレ流し込み
    theme-extractor.ts # PPTX からテーマ抽出
  components/        # React UI コンポーネント
  ipc/               # Tauri IPC ブリッジ
src-tauri/           # Rust バックエンド
tests/               # ユニットテスト
tests/e2e/           # Playwright E2E テスト
docs/                # 設計ドキュメント
themes/              # テーマ YAML ファイル
public/templates/    # スライドマスター (.pptx)
```

## 技術スタック

- **デスクトップシェル**: Tauri v2 (Rust)
- **フロントエンド**: React 19 + TypeScript 5.9
- **ビルド**: Vite 8
- **エディタ**: CodeMirror 6
- **プレビュー**: 共有 painter (ネイティブ図形 SVG)／Mermaid.js (一部フォールバック)
- **PPTX 生成**: PptxGenJS
- **スキーマ検証**: Zod
- **スタイリング**: Tailwind CSS 4
- **テスト**: Vitest + Playwright
- **CI**: GitHub Actions

## ドキュメント

- [アーキテクチャ決定記録 (ADR)](docs/adr/) — 決定済み＆実装済みの設計判断
- [ロードマップ](docs/ROADMAP.md) — 前方向きの計画
- [詳細設計](docs/design/) — 補助設計資料
- [MCP サーバの使い方](docs/mcp-server.md)

## ライセンス

Private
