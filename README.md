# SlideCraft

YAML/JSON で定義したダイアグラムを PowerPoint (.pptx) に変換するデスクトップアプリ。

Tauri v2 + React + TypeScript + PptxGenJS で構築。

## 機能

- **YAML/JSON エディタ** — CodeMirror 6 によるシンタックスハイライト付きエディタ
- **リアルタイムプレビュー** — Mermaid.js によるダイアグラムプレビュー
- **PPTX 生成** — PptxGenJS でフローチャート・スイムレーン・バスラインを PowerPoint に出力
- **テーマシステム** — YAML ベースのカスタマイズ可能なテーマ
- **テーマ抽出** — 既存 PPTX テンプレートからテーマを自動抽出
- **クロスプラットフォーム** — Windows (.msi) / macOS (.dmg) / Linux (.AppImage, .deb)

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
npm test             # ユニットテスト (Vitest, 118 tests)
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
    pptx-writer.ts   # PPTX 生成
    icons.ts         # SVG アイコン処理
    theme-extractor.ts # PPTX からテーマ抽出
  components/        # React UI コンポーネント
  ipc/               # Tauri IPC ブリッジ
src-tauri/           # Rust バックエンド
tests/               # ユニットテスト
tests/e2e/           # Playwright E2E テスト
docs/                # 設計ドキュメント
themes/              # テーマ YAML ファイル
icons/               # ダイアグラム用 SVG アイコン
```

## 技術スタック

- **デスクトップシェル**: Tauri v2 (Rust)
- **フロントエンド**: React 19 + TypeScript 5.9
- **ビルド**: Vite 8
- **エディタ**: CodeMirror 6
- **プレビュー**: Mermaid.js
- **PPTX 生成**: PptxGenJS
- **スキーマ検証**: Zod
- **スタイリング**: Tailwind CSS 4
- **テスト**: Vitest + Playwright
- **CI**: GitHub Actions

## ドキュメント

- [開発設計書](docs/DesktopApp_DevelopmentDesign.md)
- [ロードマップ](docs/ROADMAP.md)

## ライセンス

Private
