# SlideCraft ロードマップ

## v1 完了フェーズ (ダイアグラム → PPTX)

| Phase | 内容 | テスト数 | 状態 |
|-------|------|---------|------|
| P0 | PptxGenJS スパイク検証 | - | 完了 |
| P1 | schema.ts + theme.ts | 44 | 完了 |
| P2 | layout-engine.ts | 37 | 完了 |
| P3 | pptx-writer.ts | 13 | 完了 |
| P4 | icons.ts + theme-extractor.ts | 24 | 完了 |
| P5 | Tauri GUI + IPC | - | 完了 |
| P6 | E2E テスト + インストーラ | 6 (E2E) | 完了 |

**v1 合計: 118 ユニットテスト + 6 E2E テスト**

---

## v2 完了フェーズ (Markdown → PPTX テンプレート流し込み)

設計書: [MarkdownToPptx_Design.md](MarkdownToPptx_Design.md)

| Phase | 内容 | テスト数 | 状態 |
|-------|------|---------|------|
| S0 | スパイク: JSZip OOXML 操作検証 | - | 完了 |
| S1 | slide-schema.ts + md-parser.ts | 15 | 完了 |
| S2 | template-loader.ts + レイアウトレジストリ | 14 | 完了 |
| S3 | placeholder-filler.ts + md-to-ooxml.ts | 12 | 完了 |
| S4 | SlidePreview.tsx (WYSIWYG) | - | 完了 |
| S5 | GUI 統合 + テンプレート選択 + E2E | 11 (E2E) | 完了 |

**v2 合計: 41 ユニットテスト + 11 E2E テスト**

**プロジェクト全体: 159 ユニットテスト + 11 E2E テスト**

### 解決した技術課題

**OOXML スタイル階層の正しい設計:**
- Theme: `majorFont=Georgia`, `minorFont=Calibri`
- Master: `titleStyle`/`bodyStyle` でテーマフォント参照 (`+mj-lt`/`+mn-lt`)
- Layout `lstStyle`: マスターとの差分のみ（サイズ・色）をオーバーライド
- Slide: テキスト内容のみ、スタイル情報なし

**教訓:** `lstStyle` にフォント名・サイズ・色を全レベルでハードコードすると、スライドマスターの UI 編集が無効化される。レイアウトには差分のみ指定する。

---

## 今後の改善項目

### v2 改善 (優先度高)

#### スライドテンプレート再作成 — 完了
- 全30レイアウト × 151プレースホルダー復元済み
- OOXML スタイル階層正しく構築済み

#### ダイアグラムスライド — 完了
- 3つの入力形式: ```` ```mermaid ```` (SVG画像), ```` ```diagram ```` (PptxGenJSシェイプ), ```` ```mermaid-shapes ```` (変換シェイプ)
- Mermaid↔YAML↔JSON 相互変換（Edit モードで切替可能）
- サムネイル: SVG viewBox スケーリングで修正済み

#### Diagram モードの Mermaid プレビュー修復 — 完了
- `specKey` (JSON.stringify) による useEffect 再トリガー
- Mermaid 予約語 (`end` 等) のエスケープ

#### AI Assist / LLM 連携 — 完了 (基本)
- プロンプトテンプレート: スライドデッキ生成用 + ダイアグラム生成用
- コピー&ペーストワークフロー: リクエスト入力 → プロンプト生成 → LLM にコピー → 結果をインポート
- 将来: API 直接呼び出し、ローカル LLM 同梱

#### Mermaid↔DiagramSpec 変換 — 完了
- subgraph ↔ groups 双方向変換
- Edit モードで MERMAID/YAML/JSON 切替
- enterprise_network.json (36ノード, 49エッジ, 8グループ) ラウンドトリップ確認済み

#### テンプレートの色完全復元
- **サイズ**: M
- **内容**: 一部のプレースホルダーでフォント色が元のデザインと異なる
- **対応**: `create_30_layouts.py` の意図に合わせて `lstStyle` の色オーバーライドを精査

---

## v3 スライド単位エディタ (統合 UI)

V1 ダイアグラム機能を V2 Markdown パイプラインに完全統合し、スライド単位の編集 UI を提供する。

### 設計思想

- **Markdown はインポート/エクスポート形式** — 日常の編集 UI ではない
- **SlideIR[] が唯一のデータモデル** — すべての編集はここに反映
- **スライドタイプに最適な編集 UI** — テキスト、ダイアグラム、カラム等で異なるエディタ
- **V1 ダイアグラムエディタ = ダイアグラムスライドの編集モード**

### ワークフロー

```text
Markdown 入力 (Import / LLM 出力)
    ↓ parseMd()
SlideIR[] (内部データモデル)
    ↓
スライド単位エディタ (Main UI)
    ├── テキストスライド → リッチテキスト or Markdown テキストエリア
    ├── ダイアグラムスライド → YAML エディタ + Mermaid プレビュー (V1)
    ├── カラムスライド → 左右のテキストエリア
    └── KPI / Process 等 → 専用フォーム
    ↓
SlideIR[] (編集結果)
    ├── → PPTX 出力
    └── → Markdown エクスポート (LLM 再修正用)
```

### フェーズ

| Phase | 内容 | サイズ |
|-------|------|-------|
| E1 | `md-serializer.ts` — SlideIR[] → Markdown 逆変換 | S |
| E2 | スライド一覧 UI — カード表示、選択 | M |
| E3 | テキストスライドエディタ — プレースホルダー単位の編集 | M |
| E4 | ダイアグラムスライドエディタ — V1 YAML エディタ統合 | M |
| E5 | Markdown インポート/エクスポート UI | S |
| E6 | V1 Diagram モード廃止、統合完了 | S |

### 補足

- スライドの順番入れ替え・追加・削除は将来対応（優先度低）
- リッチテキストエディタの採用は制約・開発難易度次第で Markdown テキストエリアにフォールバック可
- E1 の md-serializer は LLM に修正を依頼する際に必須

---

### インフラ改善

#### アプリアイコン正式デザイン
- **サイズ**: S
- **内容**: 仮アイコン（青背景に "S"）を正式デザインに差し替え

#### バンドル識別子の修正
- **サイズ**: S
- **内容**: `com.diagram-pipeline.app` → `com.slidecraft.desktop` に変更

#### CI ビルド結果の確認・修正
- **サイズ**: S
- **内容**: GitHub Actions で Win/macOS/Linux ビルドが通ることを確認

#### 自動アップデート (Tauri Updater)
- **サイズ**: M
- **内容**: GitHub Releases 経由の自動アップデート機能

### 機能拡張 (将来)

#### CodeMirror Markdown ハイライト
- **サイズ**: S
- **内容**: エディタの言語モードを YAML から Markdown に切り替え
- **現状**: Markdown モードでも YAML ハイライトが適用されている

#### テーマ切り替え機能
- **サイズ**: M
- **内容**: 複数テンプレート PPTX の管理・切り替え

#### 追加レイアウト自動選択の改善
- **サイズ**: S
- **内容**: KPI / Process / Compare 等のレイアウト自動判定精度向上

#### 画像・チャートの Markdown 埋め込み
- **サイズ**: L
- **内容**: `![alt](path)` や ```` ```chart ```` ブロックの対応
