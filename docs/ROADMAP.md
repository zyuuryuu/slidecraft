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

#### スライドテンプレート再作成
- **サイズ**: M
- **内容**: JSZip で 30 レイアウトのテンプレートを正しく再構築
- **背景**: PowerPoint でスライド削除時に `ctrTitle` (idx=0) が消失。Closing レイアウト等でプレースホルダー欠損
- **要件**:
  - 全30レイアウトの全プレースホルダーが存在すること
  - OOXML スタイル階層: Theme(フォント名) → Master(デフォルトサイズ/色) → Layout lstStyle(差分のみ)
  - スライドマスターが PowerPoint で編集可能であること
  - `create_30_layouts.py` の設計意図と一致すること

#### Diagram モードの Mermaid プレビュー修復
- **サイズ**: S
- **内容**: モード切替後に Mermaid が再レンダリングしない問題
- **原因**: Preview コンポーネントの `useEffect` で `spec` 参照が変わらないとレンダリングしない

#### テンプレートの色完全復元
- **サイズ**: M
- **内容**: 一部のプレースホルダーでフォント色が元のデザインと異なる
- **対応**: `create_30_layouts.py` の意図に合わせて `lstStyle` の色オーバーライドを精査

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
