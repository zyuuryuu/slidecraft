# 入力サンプル集（手動テスト用）

SlideCraft をさまざまな入力で触って検証するためのサンプル。全ファイルは `parseMd` /
`structureManuscript` / `diagnoseDeck` で検証済み（`samples valid`）。

> **全機能デモ → [`sample-deck.md`](sample-deck.md)**（約30枚・全図表タイプ網羅／v0.2.0 まで
> 起動時に自動表示していたデッキ）。Draft に丸ごと貼り付けて「スライドにする」と、ネイティブ図・
> `mermaid`・表・多カラム・各種レイアウト・`<!-- note -->` スピーカーノート（「現状分析」
> スライド）を一度に試せます。

## 使い方

- **生原稿（`manuscript-*.md`）**：起動後 **📝 Draft** → モーダルで本文を貼り付け（または
  「📄 ファイルを開く」）→ **✨ 原稿を整形**（見出しごとにスライド化＋分割＋key-value→表を
  一気通貫）→ 帯の **整形レビュー** を確認 → **✓ スライドにする** で Edit へ。
  `Draft → 整形 → 診断 → 修復` の通しテスト。
- **構造化Markdown（`deck-*.md`）**：**📝 Draft** → 「📄 ファイルを開く」で読込 →（必要なら
  整形/レビュー）→ **✓ スライドにする**。Edit での図/表/レイアウト編集をテスト。
- **テンプレ切替**：ツールバー **Template** で `public/templates/slide/` の別 .pptx を読込。
  - `Midnight_Executive_30_TemplateOnly.pptx`（標準）
  - `lrk-slides-velis_CC0.pptx`（**別マスター** = "alien" テンプレ検証・CC0）

## サンプル一覧

### 生原稿（raw prose・原稿を整形で構造化）

| ファイル | 想定 | 狙う機能 |
|---|---|---|
| `manuscript-01-business-proposal.md` | 事業/サービス提案書 | 長文プローズ→condense、期待効果の「ラベル:値」→表化(visualize) |
| `manuscript-02-tech-report.md` | 負荷試験/性能レポート | 数値指標・前後比較、「指標:値」多数 |
| `manuscript-03-howto-guide.md` | セットアップ/手順ガイド | プローズ＋番号付き手順（プロセス化の素材） |
| `manuscript-04-meeting-notes.md` | 議事録（雑多） | 疎/密が不均一な節の構造化＋診断 |

→ 整形すると各 5〜6 枚、💡提案が 4〜5 件出ます。

### 構造化Markdown（SlideCraft 形式・直接インポート）

| ファイル | 想定 | 狙う機能 |
|---|---|---|
| `deck-01-mixed-layouts.md` | 製品ピッチ（10枚） | Title/Section/Column/表/Closing＋flowchart/kpi/radar をレイアウト網羅 |
| `deck-02-diagrams.md` | 図解（7枚） | **flowchart×4＋sequence をネイティブ編集**（YAML/JSON/Mermaid 切替の動作確認） |
| `deck-03-report-charts.md` | 四半期レポート | KPIカード/radar/xychart/表 の報告グラフ |
| `deck-04-stress-edgecases.md` | 診断発火用 | **整形レビューを全レバー発火**（⚠5/💡4：溢れ/長文/key-value/タイトル無し） |

## 注意（ネイティブ図の型）

ネイティブ `\`\`\`diagram` の有効 `type` は **flowchart / network / orgchart / sequence /
timeline / quadrant / pie / gantt / journey / xychart / radar / kpi**。
`class` / `state` / `er` / `mindmap` は **\`\`\`mermaid**（画像）側で記述する。
