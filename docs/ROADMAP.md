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

**合計: 118 ユニットテスト + 6 E2E テスト**

---

## v2 Markdown → PPTX (テンプレート流し込み)

設計書: [MarkdownToPptx_Design.md](MarkdownToPptx_Design.md)

| Phase | 内容 | 工数目安 | 状態 |
|-------|------|---------|------|
| S0 | スパイク: JSZip OOXML 操作検証 | 2 日 | 進行中 — テンプレートのスライドマスター問題を調査中 |
| S1 | slide-schema.ts + md-parser.ts | 3-4 日 | 未着手 |
| S2 | template-loader.ts + レイアウトレジストリ | 2-3 日 | 未着手 |
| S3 | placeholder-filler.ts + md-to-ooxml.ts | 5-7 日 | 未着手 |
| S4 | SlidePreview.tsx (WYSIWYG) | 4-5 日 | 未着手 |
| S5 | GUI 統合 + テンプレート選択 | 3-4 日 | 未着手 |
| S6 | テスト + ポリッシュ | 2-3 日 | 未着手 |

### S0 ブロッカー (解決済み)

- **問題**: テンプレート PPTX のスライドマスターが PowerPoint で編集不可
- **原因**: `lstStyle` + `rPr` にフォント・サイズ・色がハードコードされ、マスターの設定を上書きしていた
- **対応**: `lstStyle` を空にし、`rPr` のハードコードを除去。マスターの `titleStyle`/`bodyStyle` にスタイルを移行
- **残課題**: 白文字だった箇所が黒くなっている（レイアウト固有の色指定が消えた）→ 後回し

### S0 完了済み項目

- JSZip でテンプレートからスライド生成: 成功
- レイアウトのプレースホルダーコピー + テキスト差し替え: 成功 (lstStyle, spPr 保持)
- リレーション更新 (presentation.xml, Content_Types, rels): 成功
- LibreOffice での表示確認: OK

---

## v1 改善項目

### アプリアイコン正式デザイン
- **サイズ**: S
- **内容**: 仮アイコン（青背景に "S"）を正式デザインに差し替え
- **手順**: 1024x1024 PNG を用意し `npx tauri icon <file>` で全サイズ生成

### バンドル識別子の修正
- **サイズ**: S
- **内容**: `com.diagram-pipeline.app` の `.app` 末尾が macOS で警告を出す
- **対応**: `com.slidecraft.desktop` 等に変更 (`tauri.conf.json` の `identifier`)

### CI ビルド結果の確認・修正
- **サイズ**: S
- **内容**: GitHub Actions で Win/macOS/Linux ビルドが通ることを確認
- **対応**: 失敗があればプラットフォーム固有の問題を修正

### 自動アップデート (Tauri Updater)
- **サイズ**: M
- **内容**: GitHub Releases 経由の自動アップデート機能
- **参照**: 設計書 9.3 節

### macOS コード署名・公証
- **サイズ**: M
- **内容**: Apple Developer Program 加入 + Notarization 設定
- **備考**: 未加入なら「開発元不明」警告を許容

### ゴールデンファイルテスト拡充
- **サイズ**: M
- **内容**: Python 版出力との座標比較テストを追加
- **参照**: 設計書 7.3 節

### テーマ切り替え機能の実装
- **サイズ**: M
- **内容**: ThemePicker で選択したテーマを PPTX 生成に反映
- **現状**: UI はあるが生成時は常に midnight_executive を使用
