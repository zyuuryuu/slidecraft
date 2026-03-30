# Diagram Pipeline Desktop App — 開発設計書

> **Tauri + TypeScript + PptxGenJS｜Python 完全排除・方式 B アーキテクチャ**
>
> Date: 2026-03-29 &nbsp; Version: 1.0

---

## 1. 概要

### 1.1 プロジェクト目的

Diagram Pipeline（YAML/JSON → PPTX 変換ツール）をデスクトップアプリ化し、
IT 知識のないユーザでも **ワンクリックでインストール → ワンクリックで PPTX 生成** できるようにする。

### 1.2 ゴール

| # | ゴール |
|---|--------|
| G1 | シングルインストーラ（.msi / .dmg / .AppImage） |
| G2 | GUI 上で YAML 編集 → リアルタイムプレビュー → PPTX 生成 |
| G3 | Python ランタイム不要（方式 B） |
| G4 | Windows / macOS / Linux クロスプラットフォーム |

### 1.3 方式 B 採用理由

| 観点 | 方式 A（PyInstaller 同梱） | 方式 B（TypeScript 完全移植） |
|------|--------------------------|-------------------------------|
| 配布サイズ | 80–120 MB | 5–15 MB |
| 起動速度 | 5–10 秒 | < 1 秒 |
| メンテ言語 | Python + TS 二重管理 | TS のみ |
| セキュリティ審査 | Python バイナリ同梱で警告リスク | OS ネイティブ WebView のみ |

**結論**: 配布サイズ・起動速度・保守性のすべてで方式 B が優位。

---

## 2. 技術スタック

| レイヤー | 技術 | バージョン | 役割 |
|----------|------|-----------|------|
| シェル | **Tauri v2** | 2.x | OS ネイティブウィンドウ、ファイル I/O、IPC |
| フロントエンド | **React 18** | 18.x | GUI コンポーネント |
| 言語 | **TypeScript** | 5.x | 全ロジック |
| スタイル | **Tailwind CSS** | 3.x | UI スタイリング |
| PPTX 生成 | **PptxGenJS** | 3.x | スライド生成エンジン |
| プレビュー | **Mermaid.js** | 10.x | リアルタイム SVG ダイアグラム描画 |
| YAML パース | **js-yaml** | 4.x | テーマ / 入力ファイル読み込み |
| ZIP 操作 | **JSZip** | 3.x | テンプレート PPTX 内部 XML 解析 |
| 画像処理 | **sharp** | 0.33.x | SVG → PNG 変換（アイコン） |
| テスト | **Vitest** | 1.x | ユニット / ゴールデンファイルテスト |
| ビルド | **Vite** | 5.x | フロントエンドバンドル |

---

## 3. アーキテクチャ

### 3.1 全体構成

```
┌─────────────────────────────────────────────┐
│              Tauri Window (OS Native)        │
│  ┌────────────────────┬────────────────────┐ │
│  │  React Frontend    │  Preview Panel     │ │
│  │  ┌──────────────┐  │  ┌──────────────┐  │ │
│  │  │ YAML Editor  │  │  │ Mermaid SVG  │  │ │
│  │  │ (CodeMirror) │  │  │  Preview     │  │ │
│  │  ├──────────────┤  │  └──────────────┘  │ │
│  │  │ Theme Picker │  │  ┌──────────────┐  │ │
│  │  ├──────────────┤  │  │ GenerateBtn │  │ │
│  │  │ File Panel   │  │  │ [PPTX 生成]  │  │ │
│  │  └──────────────┘  │  └──────────────┘  │ │
│  └────────────────────┴────────────────────┘ │
│                    ↕ IPC (invoke)             │
│  ┌─────────────────────────────────────────┐ │
│  │  Rust Backend (Tauri Commands)          │ │
│  │  • read_file / write_file               │ │
│  │  • save_dialog / open_dialog            │ │
│  └─────────────────────────────────────────┘ │
│                    ↕                         │
│  ┌─────────────────────────────────────────┐ │
│  │  TS Engine (フロントエンド内で実行)       │ │
│  │  schema → layout → pptx-writer          │ │
│  └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

### 3.2 ディレクトリ構造

```
diagram-pipeline-desktop/
├── src-tauri/              # Rust (Tauri backend)
│   ├── src/
│   │   └── main.rs         # IPC commands (file I/O, dialogs)
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                    # TypeScript (frontend + engine)
│   ├── components/         # React UI
│   │   ├── App.tsx
│   │   ├── Editor.tsx      # YAML editor (CodeMirror)
│   │   ├── Preview.tsx     # Mermaid SVG preview
│   │   ├── ThemePicker.tsx
│   │   └── Toolbar.tsx
│   ├── engine/             # TS Engine (Python から移植)
│   │   ├── schema.ts       # DiagramSpec 型定義
│   │   ├── layout-engine.ts # レイアウト計算
│   │   ├── pptx-writer.ts  # PptxGenJS でスライド生成
│   │   ├── theme.ts        # テーマ読み書き
│   │   ├── icons.ts        # アイコン解決 + SVG→PNG
│   │   ├── theme-extractor.ts # PPTX テンプレートからテーマ抽出
│   │   └── mermaid-convert.ts # Mermaid→DiagramSpec 変換
│   ├── ipc/                # Tauri IPC ラッパー
│   │   └── commands.ts
│   └── main.tsx            # エントリポイント
├── tests/                  # Vitest テスト
│   ├── schema.test.ts
│   ├── layout.test.ts
│   ├── pptx-writer.test.ts
│   └── golden/             # ゴールデンファイル
├── icons/                  # ビルトインアイコン SVG
├── themes/                 # デフォルトテーマ YAML
├── package.json
├── tsconfig.json
├── vite.config.ts
└── vitest.config.ts
```

---

## 4. モジュール移植マッピング

### 4.1 一覧

| Python モジュール | TS モジュール | 移植難度 | 主な変更点 |
|-------------------|--------------|---------|-----------|
| `diagram_schema.py` | `schema.ts` | **低** | dataclass → interface/type。Pydantic バリデーション → Zod |
| `diagram_theme.py` | `theme.ts` | **低** | PyYAML → js-yaml。Palette dataclass → TS type |
| `diagram_renderer.py` | `layout-engine.ts` + `pptx-writer.ts` | **高** | 3,435 行の中核モジュール。レイアウト計算（純アルゴリズム）と PPTX 出力を分離 |
| `diagram_icons.py` | `icons.ts` | **低** | wand (ImageMagick) → sharp。パス解決ロジックはほぼ同一 |
| `pptx_to_theme.py` | `theme-extractor.ts` | **中** | python-pptx → JSZip で PPTX 内 XML をパース |
| `diagram_pipeline.py` | `App.tsx` + `commands.ts` | **低** | CLI エントリポイント → GUI イベントハンドラ |

### 4.2 schema.ts 詳細

```typescript
// Python の dataclass をそのまま TS interface に変換
interface Node {
  id: string;
  label: string;
  shape?: ShapeType;      // "rect" | "rounded_rect" | "diamond" | ...
  style?: NodeStyle;
  icon?: string;
  lane?: string;           // スイムレーン所属
}

interface Edge {
  from_id: string;
  to_id: string;
  label?: string;
  style?: EdgeStyle;
  bus_group?: string;      // バスライン所属
}

interface Lane {
  id: string;
  label: string;
  style?: LaneStyle;
}

interface DiagramSpec {
  title?: string;
  direction?: "TB" | "LR";
  nodes: Node[];
  edges: Edge[];
  lanes?: Lane[];
  classDefs?: Record<string, StyleDef>;
}
```

### 4.3 layout-engine.ts 詳細

renderer.py からレイアウト計算ロジックのみを抽出する。以下が主要関数：

| Python 関数 | TS 関数 | 説明 |
|-------------|---------|------|
| `_assign_layers()` | `assignLayers()` | トポロジカルソートでレイヤー割り当て |
| `_order_within_layer()` | `orderWithinLayer()` | 交差最小化 |
| `_calc_positions()` | `calcPositions()` | XY 座標計算 |
| `_detect_cp()` | `detectConnectionPoint()` | コネクタ接続点算出 |
| `_route_edge()` | `routeEdge()` | L字/Manhattan ルーティング |
| `_layout_swimlanes()` | `layoutSwimlanes()` | レーン幅・配置計算 |
| `_bus_lines()` | `layoutBusLines()` | バスライン Y 座標計算 |

**ポイント**: これらは全て純粋な座標計算であり、python-pptx への依存がない。
数値計算のみなので TS への移植は直接的。

### 4.4 pptx-writer.ts 詳細 — lxml 直接操作の置き換え

renderer.py 内で lxml（`etree`）を直接操作している箇所は **3 箇所のみ**：

#### (1) `_set_arrow()` — 行 2113

```python
# Python: OOXML 直接操作で矢印を追加
ln = connector._element.find(f'.//{{{_a}}}ln')
el = etree.SubElement(ln, tag)
el.set('type', arrow_type)
```

```typescript
// TS: PptxGenJS API で置き換え
slide.addShape("line", {
  // ...座標...
  line: { endArrowType: "triangle", width: 2 }
});
```

#### (2) `_is_diamond()` / `_cp_coords()` — 行 1217

```python
# Python: shape の内部 XML から図形タイプを判定
prst = shape._element.spPr.prstGeom.attrib.get('prst', '')
is_diamond = (prst == 'diamond')
```

```typescript
// TS: レイアウトエンジンが図形タイプを直接保持
// schema.ts の Node.shape フィールドで判定
if (node.shape === "diamond") {
  // ダイヤモンド用の接続点計算
}
```

#### (3) `_enable_auto_shrink()` — 行 2247

```python
# Python: lxml で normAutofit 要素を追加
etree.SubElement(bodyPr, f'{{{ns}}}normAutofit')
```

```typescript
// TS: PptxGenJS の fit オプション
slide.addShape("rect", {
  text: { text: label, options: { fit: "shrink" } }
});
```

> **注意**: PptxGenJS の `fit: "shrink"` は OOXML 上の `normAutofit` を設定するが、
> PowerPoint が実際にフォント縮小を適用するのはユーザ操作後の場合がある。
> **対策**: レンダラー側でフォントサイズ事前計算ロジックを実装し、
> 長いテキストには自動的に小さいフォントサイズを設定する。

---

## 5. GUI 設計

### 5.1 2 ペインレイアウト

```
┌─────────────────────────────────────────────────────────┐
│  [Open] [Save] [Generate PPTX] [Theme ▼]    Toolbar    │
├──────────────────────────┬──────────────────────────────┤
│                          │                              │
│    YAML / JSON Editor    │     Mermaid SVG Preview      │
│    (CodeMirror 6)        │     (リアルタイム更新)        │
│                          │                              │
│                          │                              │
│                          │                              │
│                          │                              │
├──────────────────────────┴──────────────────────────────┤
│  Status: Ready  |  Nodes: 12  |  Edges: 15             │
└─────────────────────────────────────────────────────────┘
```

### 5.2 ユーザフロー

1. アプリ起動 → YAML エディタが空の状態で表示
2. YAML を入力 or ファイルを開く → 右ペインに Mermaid SVG プレビューがリアルタイム表示
3. テーマを選択（ドロップダウン or YAML 内で指定）
4. 「Generate PPTX」ボタン → 保存先ダイアログ → PPTX 生成・保存

### 5.3 React コンポーネント一覧

| コンポーネント | 責務 |
|--------------|------|
| `App.tsx` | ルートレイアウト、状態管理 |
| `Editor.tsx` | CodeMirror 6 による YAML/JSON 編集。構文ハイライト、エラー表示 |
| `Preview.tsx` | DiagramSpec → Mermaid 記法変換 → SVG レンダリング |
| `ThemePicker.tsx` | テーマ YAML 一覧表示・選択 |
| `Toolbar.tsx` | Open / Save / Generate ボタン群 |
| `StatusBar.tsx` | ノード数、エッジ数、バリデーション状態表示 |

---

## 6. IPC 設計

### 6.1 Tauri Commands（Rust 側）

```rust
#[tauri::command]
fn read_file(path: String) -> Result<String, String> { /* ... */ }

#[tauri::command]
fn write_file(path: String, content: Vec<u8>) -> Result<(), String> { /* ... */ }

#[tauri::command]
fn open_dialog(filters: Vec<DialogFilter>) -> Result<Option<String>, String> { /* ... */ }

#[tauri::command]
fn save_dialog(default_name: String) -> Result<Option<String>, String> { /* ... */ }
```

### 6.2 データフロー

```
User Input (YAML)
  │
  ▼
schema.ts (parse & validate)
  │
  ▼
layout-engine.ts (座標計算)
  │
  ▼
pptx-writer.ts (PptxGenJS で PPTX バイナリ生成)
  │
  ▼
IPC: invoke("write_file", { path, content })
  │
  ▼
Rust: ファイルシステムに書き込み
```

PPTX 生成はフロントエンド（TS）で完結する。
Rust 側が担当するのはファイル I/O とネイティブダイアログのみ。

---

## 7. テスト戦略

### 7.1 テストフレームワーク

**Vitest** を採用。Jest 互換 API + Vite ネイティブの高速実行。

### 7.2 テストカテゴリ

| カテゴリ | 対象 | 手法 |
|---------|------|------|
| スキーマバリデーション | `schema.ts` | 正常系 / 異常系の入力を Zod でバリデーション |
| レイアウト座標 | `layout-engine.ts` | 既知の入力に対する座標スナップショットテスト |
| PPTX 出力 | `pptx-writer.ts` | ゴールデンファイル比較（バイナリ → XML 展開して diff） |
| テーマ | `theme.ts` | YAML 読み書きラウンドトリップ |
| テーマ抽出 | `theme-extractor.ts` | サンプル PPTX からの抽出結果を検証 |
| E2E | GUI 全体 | Tauri の WebDriver テスト or Playwright |

### 7.3 ゴールデンファイルテスト

Python 版の出力 PPTX を「正解」として保持し、TS 版の出力と比較する。

```
tests/golden/
├── input/
│   ├── simple_flow.yaml
│   ├── swimlane.yaml
│   └── bus_lines.yaml
├── expected/
│   ├── simple_flow/       # PPTX を展開した XML
│   ├── swimlane/
│   └── bus_lines/
└── snapshots/             # Vitest スナップショット
```

比較手順:
1. PPTX は ZIP なので JSZip で展開
2. `ppt/slides/slide1.xml` を抽出
3. XML を正規化（属性ソート、空白除去）して diff
4. 座標値は ±1% の許容誤差で比較

---

## 8. 開発ロードマップ

### 8.1 フェーズ一覧

| Phase | 内容 | 工数目安 | 完了条件 |
|-------|------|---------|---------|
| **P0** | スパイク検証 | 2 日 | ✅ **完了** — PptxGenJS で全シェイプ・矢印・破線・fit 確認済 |
| **P1** | schema.ts + theme.ts | 3 日 | Zod バリデーション通過、YAML ラウンドトリップテスト通過 |
| **P2** | layout-engine.ts | 5–8 日 | Python 版と同一座標を出力（ゴールデンファイルテスト通過） |
| **P3** | pptx-writer.ts | 5–8 日 | 全シェイプ・矢印・テキスト・アイコン・スイムレーン・バスラインの PPTX 生成 |
| **P4** | icons.ts + theme-extractor.ts | 2–3 日 | SVG→PNG 変換、テンプレート PPTX からテーマ抽出 |
| **P5** | Tauri GUI + IPC | 4–5 日 | 2 ペイン GUI、リアルタイムプレビュー、PPTX 生成ボタン動作 |
| **P6** | E2E テスト + インストーラ | 2–3 日 | Win / macOS / Linux ビルド成功、基本シナリオ E2E 通過 |

**合計見積: 23–32 工日**（1 人開発想定）

### 8.2 フェーズ依存関係

```
P0 ✅ ─→ P1 ─→ P2 ─→ P3 ─→ P5
                         ↗         ↘
                   P4 ──┘           P6
```

P1（schema）は全モジュールの基盤。P2（layout）と P3（writer）は P1 完了後に着手。
P4（icons / theme-extractor）は P3 と並行可能。P5（GUI）は P3 完了後。P6 は最後。

---

## 9. 配布・インストーラ

### 9.1 プラットフォーム別フォーマット

| OS | フォーマット | 推定サイズ |
|----|------------|-----------|
| Windows | `.msi` / `.exe` (NSIS) | 5–10 MB |
| macOS | `.dmg` / `.app` | 8–15 MB |
| Linux | `.AppImage` / `.deb` | 5–12 MB |

### 9.2 Tauri ビルド設定

```json
// tauri.conf.json (抜粋)
{
  "bundle": {
    "active": true,
    "targets": ["msi", "dmg", "appimage", "deb"],
    "identifier": "com.diagram-pipeline.app",
    "icon": ["icons/icon.png"]
  }
}
```

### 9.3 自動アップデート

Tauri Updater プラグインを使用。GitHub Releases に新バージョンをパブリッシュすると、
アプリ起動時に自動チェック → ユーザ確認 → バックグラウンドダウンロード → 再起動で適用。

```json
{
  "plugins": {
    "updater": {
      "endpoints": ["https://github.com/{owner}/{repo}/releases/latest/download/latest.json"],
      "dialog": true
    }
  }
}
```

---

## 10. リスクと緩和策

| # | リスク | 深刻度 | 発生確率 | 緩和策 |
|---|--------|--------|---------|--------|
| R1 | PptxGenJS の `fit: "shrink"` が PowerPoint で即時反映されない | 中 | 高 | レンダラー側でフォントサイズ事前計算ロジックを実装 |
| R2 | レイアウトエンジン移植で Python 版と座標差異 | 中 | 中 | ゴールデンファイルテストで ±1% 許容誤差、段階的にテストケース追加 |
| R3 | sharp（SVG→PNG）が Tauri バンドル時に問題 | 低 | 中 | sharp は native addon。問題時は `@resvg/resvg-js`（WASM）に切替 |
| R4 | Mermaid.js プレビューと実 PPTX の見た目が乖離 | 低 | 高 | プレビューは「概要確認用」と位置付け、完全一致は非ゴールとする |
| R5 | Tauri v2 の安定性・ドキュメント不足 | 低 | 低 | Tauri v2 は 2024 年に stable リリース済み。コミュニティも活発 |
| R6 | macOS コード署名・公証（Notarization） | 中 | 中 | Apple Developer Program 加入が必要。未加入なら「開発元不明」警告を許容 |

---

## 付録 A: Phase 0 検証結果 — PptxGenJS シェイプマッピング

Phase 0 スパイクで **実際にコード実行して検証済み**。

| DiagramSpec シェイプ | PptxGenJS ShapeType | 検証状態 |
|---------------------|---------------------|---------|
| `rect` | `rect` | ✅ 確認済 |
| `rounded_rect` | `roundRect` | ✅ 確認済 |
| `diamond` | `diamond` | ✅ 確認済 |
| `circle` / `oval` | `ellipse` | ✅ 確認済 |
| `hexagon` | `hexagon` | ✅ 確認済 |
| `line` | `line` | ✅ 確認済 |

### 追加検証項目

| 機能 | PptxGenJS API | 検証状態 |
|------|-------------|---------|
| 矢印 | `line.endArrowType: "triangle"` | ✅ 確認済 |
| 破線 | `line.dashType: "dash"` | ✅ 確認済 |
| 塗りつぶし | `fill: { color: "FF0000" }` | ✅ 確認済 |
| 枠線 | `border: { color: "000000", pt: 1 }` | ✅ 確認済 |
| テキスト | `text` オプション | ✅ 確認済 |
| 画像埋め込み | `slide.addImage({ path })` | ✅ 確認済 |
| テキスト自動縮小 | `fit: "shrink"` | ⚠️ OOXML 設定は可。PowerPoint 側の即時反映に制限あり |

**Phase 0 判定: ✅ Go**

---

## 付録 B: 用語集

| 用語 | 説明 |
|------|------|
| **DiagramSpec** | YAML/JSON で記述するダイアグラム定義の型 |
| **PptxGenJS** | JavaScript 用の PPTX 生成ライブラリ |
| **Tauri** | Rust + WebView ベースの軽量デスクトップアプリフレームワーク |
| **IPC** | Inter-Process Communication。Tauri の invoke() による Rust ↔ TS 通信 |
| **ゴールデンファイル** | テストの「正解」として保持する期待出力ファイル |
| **スイムレーン** | フローチャートを部署/担当者別に区分する水平帯 |
| **バスライン** | 複数エッジを 1 本の幹線に束ねる配線パターン |
| **sharp** | Node.js 用高速画像処理ライブラリ（libvips ベース） |
| **Zod** | TypeScript ファーストのスキーマバリデーションライブラリ |
