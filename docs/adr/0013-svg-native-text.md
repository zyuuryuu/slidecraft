# ADR-0013: 図テキストを SVG `<text>` に統一（foreignObject 廃止・印刷/canvas 堅牢化）

- **Status**: Accepted
- **Date**: 2026-07-04

## Context

図テキストは `src/engine/svg-writer.ts` の `text()` が**すべて `<foreignObject>`＋XHTML `<div>`** で描画していた。画面表示は全ブラウザで問題ないが、`<foreignObject>` は次の経路で**脱落**する：

- **canvas ラスタライズ**（`canvas.drawImage(svg)`）— [ADR-0003](0003-diagram-pipeline.md) の Mermaid ラスタ経路が既に回避（`mermaid.ts` の `htmlLabels:false`）。
- **一部の印刷/PDF エンジン**（WebKitGTK＝Tauri Linux・一部 Safari/WKWebView・headless）— スタンダロン HTML の **Ctrl-P → PDF で図の文字が消える**。共有デッキの PDF 化という中核ユースケースで致命的。

プレビュー（`DiagramSvgOverlay`）と HTML エクスポート（`deck-html-export` → `SlideCard`）は**同一の `renderDiagramToSvg` 出力**を埋め込む（[ADR-0003](0003-diagram-pipeline.md)：共有 painter は分岐し得ない）。よって「HTML だけ `<text>`」にすると preview↔HTML が構造的にズレる。

## Decision

`svg-writer` の `text()` を **native SVG `<text>`/`<tspan>` に全面移行し `<foreignObject>` を廃止**する。プレビュー／HTML／印刷／canvas が**すべて同一の `<text>` SVG を共有**するため、WYSIWYG（[ADR-0003](0003-diagram-pipeline.md)）を維持したまま**全エンジンで印刷堅牢**になる。

- 各 `TextRun`＝1行（`draw-target.ts` の契約）を `dy` スタックした `<tspan>` で描く。水平は `align → text-anchor`（start/middle/end）、垂直は `valign` と行数から baseline `y` を計算（`ASCENT=0.875` が旧 flex の half-leading を吸収）。
- `<foreignObject>` が CSS で担っていた**折返し／クリップ**を2つの決定論ロジックで代替：
  1. `opts.wrap` ラベル（timeline/quadrant/swimlane/journey）は `wrapToWidth` で近似折返し（文字幅推定＝CJK≈1em / Latin≈0.55em、溢れ防止側にやや広め）。
  2. `opts.shrink` ラベルは推定最大幅で `font-size` を縮小（PowerPoint の `fit:"shrink"` と同義）→ ボックス外への溢れを防ぐ。従来プレビューは縮小せず overflow:hidden でクリップしていた。
- 変更は **`svg-writer.ts` に閉じる**（配線変更ゼロ・両サーフェスが同一 `renderDiagramToSvg` を呼ぶため統一が自動伝播）。

決定プロセス：設計調査ワークフロー（3レンズ：エミッタ/パリティ/テスト）→ 実装 → 敵対検証（ベースライン計算・wrap エッジ・空行・溢れをトレース）。敵対検証で見つけた**空 run のファントム行**と**溢れ回帰**を修正（後者を shrink で解決）。ユーザは「全面統一（プレビューも `<text>`）」を選択。

## Consequences

**良い点**
- **全エンジン／Linux／canvas／印刷で図テキストが残る**（`<foreignObject>` 脱落の根絶）。スタンダロン HTML の Ctrl-P → PDF が堅牢に。
- preview==HTML==print==canvas が**同一 SVG**＝単一 painter の原則（[ADR-0003](0003-diagram-pipeline.md)）を強化。マークアップも `<foreignObject>+div` ツリーより小さい。
- `shrink` 実装でプレビューが PPTX の `fit:"shrink"` に近づく（従来プレビューは縮小せずクリップだった）。

**代償・限界**
- プレビューの文字描画が `<foreignObject>`→SVG `<text>` に変化（大半はアンチエイリアス差、ベースラインは `ASCENT=0.875` の近似）。**ユーザ承認済み**の意図的統一。
- 折返し／縮小は文字幅**ヒューリスティック（推定）**でありブラウザ実測と完全一致はしない。溢れ防止側に倒している。**縦方向の溢れ**（折返しが箱高さを超過）はクリップしない残エッジ（稀・将来 clipPath 検討）。
- golden（PPTX バイト）は**不変**：`scripts/diagram-golden.ts` は `ppt/slides/slide1.xml`（`PptxDrawTarget`）のみをハッシュし、`SvgDrawTarget` は無変更。R5 の座標（±1%）はテキスト**要素型のみ**の変更で幾何は不変。

## References

- [ADR-0003](0003-diagram-pipeline.md) — 図パイプライン＝共有 painter（本 ADR は SVG テキスト backend を `<foreignObject>` から `<text>` へ）
- [docs/design/html-output.md](../design/html-output.md) — S6 印刷/PDF 堅牢化
- 実装：`src/engine/svg-writer.ts`（`text` / `wrapToWidth` / `estWidth`）。テスト：`tests/svg-writer-text.test.ts`、`tests/svg-writer.test.ts`（モード非依存で全緑）。
