# Markdown → PPTX 設計書

> ⚠️ **歴史的記録（v2 当時の設計書）。** その後 AI(DeckPlan/Ollama)・ネイティブ表/14図種・
> デスクトップ化など大きく前進。**現状とロードマップは [ROADMAP.md](ROADMAP.md) を正**とする。
>
> SlideCraft v2: LLM が書いた Markdown をテンプレート PPTX に流し込む

---

## 1. 概要

### 1.1 目的

LLM にスライド内容を Markdown で執筆させ、既存の会社テンプレート PPTX のプレースホルダーに流し込むことで、高品質な PowerPoint を生成する。

### 1.2 ゴール

| ID | ゴール |
|----|--------|
| G1 | Markdown → テンプレート PPTX のプレースホルダー流し込み |
| G2 | JSZip + OOXML 直接操作（スライドマスター一括編集を維持） |
| G3 | WYSIWYG プレビュー + Markdown↔プレビュー連携 |
| G4 | 30 種レイアウトの自動/明示選択 |

### 1.3 設計方針

- PptxGenJS は新規生成専用のため不採用。JSZip で OOXML を直接操作
- テンプレート .pptx はユーザーが PowerPoint で自由に編集可能
- Markdown 記法は LLM が自然に書けるよう標準 Markdown を基盤とする
- 既存のダイアグラム機能（PptxGenJS）は独立して維持

---

## 2. アーキテクチャ

### 2.1 パイプライン

```
Markdown テキスト
   ↓ md-parser.ts
SlideIR[] (中間表現)
   ↓ + テンプレート .pptx
   ↓ template-loader.ts (JSZip でレイアウト解析)
   ↓ placeholder-filler.ts (OOXML XML 操作)
   ↓
.pptx バイナリ出力
   ↓
WYSIWYG プレビュー (HTML/CSS)
```

### 2.2 新規モジュール

| モジュール | 責務 | 場所 |
|-----------|------|------|
| `slide-schema.ts` | SlideIR 型定義 + Zod バリデーション | `src/engine/` |
| `md-parser.ts` | Markdown → SlideIR[] パーサー | `src/engine/` |
| `template-loader.ts` | テンプレート PPTX 解析、レイアウトレジストリ構築 | `src/engine/` |
| `placeholder-filler.ts` | SlideIR[] + テンプレート → PPTX 生成 | `src/engine/` |
| `md-to-ooxml.ts` | Markdown インライン記法 → OOXML `<a:r>` 変換 | `src/engine/` |
| `SlidePreview.tsx` | WYSIWYG プレビューコンポーネント | `src/components/` |

### 2.3 既存モジュールとの関係

- `theme-extractor.ts` — JSZip + OOXML 解析のパターンを踏襲
- `schema.ts` — `DiagramSpec` とは独立した `SlideIR` を定義
- `pptx-writer.ts` — ダイアグラム用（PptxGenJS）はそのまま維持
- `theme.ts` — プレビュー描画時のカラーパレット参照に共用

---

## 3. Markdown 記法仕様

### 3.1 基本構造

```markdown
---
template: Midnight_Executive_30_Template.pptx
---

<!-- slide: Title.1Title.Single -->
# プレゼンテーションタイトル
## サブタイトル

Category: DATA ANALYSIS REPORT
Date: 2026-03-30 | 組織名 | 部門名
Footer: Confidential

---

<!-- slide: Content.1Body.Single -->
# スライドタイトル
> 英語サブタイトル

本文テキスト。**太字**や*斜体*が使える。

- 箇条書き項目 1
- 箇条書き項目 2
- 箇条書き項目 3

---

<!-- slide: Column.2Body.Equal -->
# 二カラム比較
> Comparison

<!-- col -->
左カラムの内容。

- ポイント A
- ポイント B

<!-- col -->
右カラムの内容。

- ポイント C
- ポイント D

---

<!-- slide: KPI.3Value.Equal -->
# 主要指標
> Key Metrics

<!-- kpi -->
98.5%
稼働率
目標: 99.0%

<!-- kpi -->
$2.4M
売上
前年比 +15%

<!-- kpi -->
847
アクティブユーザー
前月比 +23%

---

<!-- slide: Process.4Step.Sequential -->
# 導入計画
> Implementation Plan

<!-- step -->
Phase 1
要件定義
2026 Q2

<!-- step -->
Phase 2
開発・テスト
2026 Q3-Q4

<!-- step -->
Phase 3
パイロット
2027 Q1

<!-- step -->
Phase 4
全社展開
2027 Q2
```

### 3.2 要素マッピング

| Markdown 要素 | PPTX プレースホルダー |
|--------------|---------------------|
| `---` (水平線) | スライド区切り |
| `<!-- slide: LayoutName -->` | レイアウト指定 |
| `# 見出し` | タイトル (idx 15) |
| `> 引用` (見出し直後) | サブタイトル (idx 16) |
| 本文テキスト | メイン本文 (idx 1) |
| `<!-- col -->` 区切り | サブコンテンツ (idx 2, 3, 4) |
| `<!-- kpi -->` 区切り | KPI 値 (idx 1, 2, 3, ...) |
| `<!-- step -->` 区切り | プロセスステップ (idx 1, 2, 3, ...) |
| `**太字**` | `<a:rPr b="1">` |
| `*斜体*` | `<a:rPr i="1">` |
| `- リスト` | `<a:p>` + ブレット |
| `<!-- note -->` 以降（スライド末尾まで） | スピーカーノート（`SlideIR.notes` → `ppt/notesSlides/notesSlideN.xml`、ADR-0032 D1） |

`<!-- note -->` はマーカー単独行のみが記法で、以降のノート本文は素の Markdown（複数行・箇条書き・強調可）。
notes が空のスライドには notesSlide パートを一切生成しない（ノート無しデッキの出力不変を構造的に担保）。
distill の自動分割時、ノートは先頭チャンクのみに残す。

### 3.3 タイトルスライド専用フィールド

タイトルレイアウト (Title.*) では、本文部分を `Key: Value` 形式で解釈:

| キー | プレースホルダー |
|-----|-----------------|
| `Category:` | CategoryLabel (idx 10) |
| `Date:` | Date.Bottom (idx 11) |
| `Footer:` | Footer.Bottom (idx 12) |
| `Meta:` | Meta.Right (idx 11, レイアウト依存) |
| `Summary:` | Summary.Right (idx 11, レイアウト依存) |

### 3.4 レイアウト自動選択

`<!-- slide: -->` を省略した場合のヒューリスティック:

| Markdown 構造 | 自動選択レイアウト |
|--------------|------------------|
| 最初のスライド | `Title.1Title.Single` |
| `#` のみ（本文なし） | `Section.1Title.Single` |
| `#` + 本文 | `Content.1Body.Single` |
| `#` + `<!-- col -->` x2 | `Column.2Body.Equal` |
| `#` + `<!-- col -->` x3 | `Column.3Body.Equal` |
| `#` + `<!-- kpi -->` x1〜4 | `KPI.{N}Value.*` |
| `#` + `<!-- step -->` x3〜4 | `Process.{N}Step.Sequential` |
| タイトルに "thank" / "感謝" | `Closing.1Message.Single` |

---

## 4. テンプレートレイアウトレジストリ

### 4.1 レイアウト一覧

| # | レイアウト名 | カテゴリ | プレースホルダー idx |
|---|------------|---------|---------------------|
| 0 | Title.1Title.Single | Title | 10, 0, 1, 11, 12 |
| 1 | Title.1Title.Single+1Meta | Title | 10, 0, 1, 11, 12 |
| 2 | Title.1Title.Single+1Summary | Title | 10, 0, 1, 11, 12 |
| 3 | Section.1Title.Single | Section | 10, 15, 11 |
| 4 | SectionNav.1Title.Single | Section | 10, 11, 15, 12 |
| 5 | SectionBreak.1Title.Single | Section | 10, 15, 11 |
| 6 | Content.1Body.Single | Content | 15, 16, 1, 50 |
| 7 | Content.1Body.Single+1Notes | Content | 15, 16, 1, 2, 50 |
| 8 | Content.1Body.Single+1Source | Content | 15, 16, 1, 2, 50 |
| 9 | Content.1Body.Single+1Callout | Content | 15, 16, 2, 1, 50 |
| 10 | Column.2Body.Equal | Column | 15, 16, 1, 2, 50 |
| 11 | Column.2Body.MainSub | Column | 15, 16, 1, 2, 50 |
| 12 | Column.3Body.Equal | Column | 15, 16, 1, 2, 3, 50 |
| 13 | KPI.1Value.Single | KPI | 15, 16, 1, 2, 3, 50 |
| 14 | KPI.2Value.Equal | KPI | 15, 16, 1, 2, 3, 4, 50 |
| 15 | KPI.3Value.Equal | KPI | 15, 16, 1, 2, 3, 4, 5, 6, 50 |
| 16 | KPI.4Value.Grid | KPI | 15, 16, 1, 2, 3, 4, 50 |
| 17 | Chart.1Chart.Single | Chart | 15, 16, 1, 50 |
| 18 | Chart.1Chart.Single+1Analysis | Chart | 15, 16, 1, 2, 50 |
| 19 | Chart.2Chart.Equal | Chart | 15, 16, 1, 2, 50 |
| 20 | Table.1Table.Single+1Source | Table | 15, 16, 1, 2, 50 |
| 21 | Table.1Table.Single+1Notes | Table | 15, 16, 1, 2, 50 |
| 22 | Compare.2Option.Versus | Compare | 15, 16, 1, 2, 3, 4, 50 |
| 23 | Compare.1Matrix.Single | Compare | 15, 16, 50 |
| 24 | Process.4Step.Sequential | Process | 15, 16, 1, 2, 3, 4, 50 |
| 25 | Process.3Step.Sequential | Process | 15, 16, 1, 2, 3, 50 |
| 26 | Summary.1Agenda.Single | Summary | 15, 16, 1 |
| 27 | Summary.2Block.Equal | Summary | 15, 16, 1, 2, 50 |
| 28 | Closing.1Message.Single | Closing | 10, 0, 11, 12 |
| 29 | Closing.1Steps.Single+1Notes | Closing | 15, 1, 2 |

### 4.2 プレースホルダー意味規約

| idx | コンテンツスライド | タイトルスライド |
|-----|------------------|----------------|
| 0 | - | メインタイトル (ctrTitle) |
| 1 | メイン本文 / サブタイトル | サブタイトル (subTitle) |
| 2〜6 | サブコンテンツ | - |
| 10 | - | カテゴリラベル |
| 11 | - | 日付 / メタ情報 |
| 12 | - | フッター |
| 15 | スライドタイトル | セクションタイトル |
| 16 | スライドサブタイトル | - |
| 50 | スライド番号 (自動) | - |

---

## 5. OOXML 操作戦略

### 5.1 スライド生成フロー

1. JSZip でテンプレート .pptx を展開
2. 対象の `slideLayout{N}.xml` を特定
3. 新しい `slide{N}.xml` を作成（テンプレートスライドをベースに）
4. `<p:ph idx="N">` を持つシェイプの `<a:t>` テキストを差し替え
5. `<a:rPr>` スタイルはレイアウトの `lstStyle` から継承（上書きしない）
6. リレーション更新: `[Content_Types].xml`, `presentation.xml`, `_rels/*.rels`
7. JSZip で再パッケージ → .pptx バイナリ出力

### 5.2 テキスト差し替え方針

```xml
<!-- テンプレートのプレースホルダー -->
<p:sp>
  <p:nvSpPr>
    <p:nvPr><p:ph idx="1"/></p:nvPr>
  </p:nvSpPr>
  <p:txBody>
    <a:lstStyle><!-- フォント・サイズ・色はここで定義済み --></a:lstStyle>
    <a:p>
      <a:r><a:t>プロンプトテキスト</a:t></a:r>  <!-- ← ここだけ差し替え -->
    </a:p>
  </p:txBody>
</p:sp>
```

- `lstStyle` の `defRPr` はそのまま保持（フォント・サイズ・色・太字はテンプレート側の設定を使う）
- `<a:r><a:t>` のテキストノードのみ差し替え
- 改行は `<a:br/>` + 新しい `<a:p>` で表現
- 太字/斜体が必要な場合のみ `<a:rPr>` を付与

### 5.3 リッチテキスト変換

| Markdown | OOXML |
|----------|-------|
| 通常テキスト | `<a:r><a:t>text</a:t></a:r>` |
| `**bold**` | `<a:r><a:rPr b="1"/><a:t>bold</a:t></a:r>` |
| `*italic*` | `<a:r><a:rPr i="1"/><a:t>italic</a:t></a:r>` |
| `- item` | `<a:p><a:pPr lvl="0"><a:buChar char="▸"/></a:pPr><a:r><a:t>item</a:t></a:r></a:p>` |
| 改行 | `</a:p><a:p>` |

---

## 6. プレビュー設計

### 6.1 方式

HTML/CSS でテンプレートの視覚スタイルを近似的に再現する。

- 各スライドを `<div>` としてレンダリング（13.33:7.5 比率）
- テンプレートのカラーパレット・フォント設定を CSS に変換
- プレースホルダーの位置・サイズをレイアウトレジストリから取得して `position: absolute` で配置

### 6.2 Markdown↔プレビュー連携

- エディタのカーソル位置からスライド番号・プレースホルダーを特定
- 対応するプレビュー要素をハイライト表示
- プレビュー要素クリックでエディタの該当行にジャンプ

### 6.3 制約

- フォントメトリクスが PowerPoint と完全一致しないため、テキスト折り返しは近似
- 装飾シェイプ（背景パネル、アクセントバー等）はレイアウト情報から描画
- プレビューは「確認用」であり、最終出力は PPTX を PowerPoint で開いて確認

---

## 7. 開発ロードマップ

### 7.1 フェーズ一覧

| Phase | 内容 | 工数目安 | 完了条件 |
|-------|------|---------|---------|
| S0 | スパイク: JSZip OOXML 操作検証 | 2 日 | テンプレートから 3 スライド PPTX を生成し PowerPoint で開ける |
| S1 | slide-schema.ts + md-parser.ts | 3-4 日 | Markdown → SlideIR[] 変換、ユニットテスト通過 |
| S2 | template-loader.ts + レイアウトレジストリ | 2-3 日 | テンプレート解析 + レイアウト自動選択テスト通過 |
| S3 | placeholder-filler.ts + md-to-ooxml.ts | 5-7 日 | Markdown → PPTX 生成、ゴールデンファイルテスト通過 |
| S4 | SlidePreview.tsx (WYSIWYG) | 4-5 日 | プレビュー表示 + Markdown↔プレビュー連携 |
| S5 | GUI 統合 + テンプレート選択 | 3-4 日 | エディタ→プレビュー→PPTX 出力の全パイプライン動作 |
| S6 | テスト + ポリッシュ | 2-3 日 | E2E テスト、エッジケース、エラーメッセージ |

**合計見積: 21-28 工日** (1 人開発)

### 7.2 フェーズ依存関係

```
S0 → S1 → S2 → S3 → S5 → S6
                  ↘  S4 ↗
```

S4 (プレビュー) は S2 完了後に S3 と並行着手可能。

---

## 8. リスクと緩和策

| # | リスク | 深刻度 | 発生確率 | 緩和策 |
|---|--------|--------|---------|--------|
| R1 | スライド生成時のリレーション管理が複雑 | 高 | 高 | S0 スパイクで検証。`ooxml-rels.ts` ユーティリティを専用実装 |
| R2 | プレースホルダーのスタイル継承が壊れる | 高 | 中 | `<a:t>` テキストのみ差し替え、`<a:rPr>` は最小限。PowerPoint / LibreOffice / Google Slides で検証 |
| R3 | レイアウト自動選択の精度 | 中 | 中 | `<!-- slide: -->` 明示指定を推奨、自動選択は補助 |
| R4 | リッチテキスト (太字, 箇条書き) の OOXML 変換 | 中 | 中 | 初期は太字・斜体・改行・箇条書きに限定 |
| R5 | プレビューの表示忠実度 | 低 | 高 | 「確認用」と位置付け、完全一致は非ゴール |
| R6 | テンプレート変更時のレジストリ不整合 | 中 | 中 | レジストリはテンプレートからランタイム生成、ハードコードしない |

---

## 9. テスト戦略

| カテゴリ | 対象 | 手法 |
|---------|------|------|
| Markdown パーサー | md-parser.ts | 入力 Markdown → 期待 SlideIR[] の一致テスト |
| レイアウト選択 | template-loader.ts | SlideIR → 正しいレイアウトインデックスの選択テスト |
| OOXML 生成 | placeholder-filler.ts | Markdown → PPTX → JSZip 展開 → XML フラグメント比較 |
| リッチテキスト | md-to-ooxml.ts | Markdown インライン → OOXML `<a:r>` 変換テスト |
| E2E | GUI 全体 | Playwright: エディタ入力 → プレビュー表示 → PPTX ダウンロード |

---

## 付録 A: LLM 向け Markdown 記法クイックリファレンス

```
---                              ← スライド区切り
<!-- slide: LayoutName -->       ← レイアウト指定 (省略可)
# タイトル                        ← スライドタイトル
> サブタイトル                     ← スライドサブタイトル
本文テキスト                      ← メインコンテンツ
**太字** *斜体*                   ← インライン書式
- 箇条書き                        ← ブレットリスト
<!-- col -->                      ← カラム区切り
<!-- kpi -->                      ← KPI 区切り
<!-- step -->                     ← プロセスステップ区切り
```

## 付録 B: OOXML 名前空間

| 接頭辞 | URI |
|-------|-----|
| `a` | `http://schemas.openxmlformats.org/drawingml/2006/main` |
| `p` | `http://schemas.openxmlformats.org/presentationml/2006/main` |
| `r` | `http://schemas.openxmlformats.org/officeDocument/2006/relationships` |
