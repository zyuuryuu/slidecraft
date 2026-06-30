# ADR-0003: 図パイプライン＝DiagramSpec 正典＋共有 painter

- **Status**: Accepted
- **Date**: 2026-06（DiagramSpec を正典と確定したのは 2026-06-20、v4 のネイティブ図拡充完了まで）

## Context

- 出力が PPTX である以上、ユーザ最重視事項は「**プレビューと生成 PPTX に差があるのは不可**」。
- 旧構成は ```diagram と ```mermaid で描画経路が分かれ、Mermaid プレビューを mermaid.js が別レイアウト・別色で描いていた。座標も色も食い違い、しかも生成物は**編集不能な画像**だった（「Mermaid モード ≠ JSON モードのデザイン」問題の根本原因）。
- 図を「パワポ資料として可能な限りオブジェクト（編集可能図形）として起こしたい」という要件があり、画像貼り込みは受け入れられない。

## Decision

- **DiagramSpec（同一データの JSON / YAML 二表現、JSON が「正」）を唯一の正典フォーマットとする。** Mermaid は**入力専用**で、parse 時にネイティブ型へ自動 graduate（md-parser / `mermaidToDiagramSpec`）し `.diagram` として保持。MERMAID↔YAML↔JSON は無損失往復（`diagram-serialize.ts`、ゲートは `canSerializeToMermaid`）。
- **描画は backend 非依存の単一 painter `paintDiagram(target, spec, options)` に集約。** 幾何は layout-engine が計算し、抽象プリミティブ（`background`/`shape`/`line`/`text`/`wedge`＋`beginGroup`/`endGroup`）を `DrawTarget` に発行する（`draw-target.ts`）。
- **2 つの backend が同じ painter を通る**：`PptxDrawTarget`（編集可能 PPTX ネイティブ図形）と `SvgDrawTarget`（プレビュー SVG）。よってプレビューと書き出しは**構造的に乖離不能＝WYSIWYG**。
- **ネイティブ図 14 種**（flowchart / class / sequence / state / ER / timeline / quadrant / pie / gantt / journey / mindmap ＋報告グラフ xychart / radar / kpi）を編集可能図形として描画。node-edge 以外は「第2エンジン」として `paintFitted` 経由で自前 layout＋単一トップグループに収める。`node.icon` は 15 種のネイティブグリフで描画（画像ではない）。
- **画像フォールバックは残りの非ネイティブ Mermaid（gitGraph / sankey / C4 / requirement 等）に限定。** プレビューでもこの場合のみ `MermaidDirect`（mermaid.js 画像）へ落ちる。判定は**フォーマットベースで、スライド番号ベースではない**。
- **図は「バラバラの図形」ではなくネイティブの入れ子グループとして書き出す。** painter が論理単位を `beginGroup/endGroup` で囲い、埋め込み経路（placeholder-filler）だけが `renderToBufferWithGroups`＋`nestShapeXml` で生成後 XML を `<p:grpSp>` に入れ子化（`chOff==off` の純コンテナ）。スタンドアロンの `renderToBuffer` はフラットのまま。

## Consequences

- 図の描画・座標を変えるときは **painter を 1 箇所だけ直す**（両 backend に効く）。**backend 片方だけ直すのは禁止**（乖離する）。新チャートは computeXLayout＋paintX＋`paintDiagram` の 1 分岐で追加できる。
- **不変条件（崩すな）**：shape/line/text 1 呼び出し＝生成 XML の 1 図形（＝1 リーフ）。崩れるとリーフ数不一致で `nestShapeXml` がフラットへ自動フォールバック（図形は落とさないが入れ子が付かない）。
- 書き出し（placeholder-filler）はフルスライドの図形を絶対座標で重ねる（背景 rect は抽出されない）。よって**プレビューは透明・フルスライドの SVG オーバーレイ**にして書き出しと一致させる（`SvgRenderOptions.transparent` ＋ 埋め込み時 `omitTitle`）。
- 文字色は固定にせず背景コントラストから導出する（裸テキストは `bareTextColor(theme)`）。**白固定は厳禁**（ライトテーマで不可視化する）。任意テンプレート整合のためのガードレール。
- 検証：PPTX を壊していないかは `scripts/diagram-golden.ts` の `slideXmlHashes()` を vitest 経由で実行し、slide1.xml のハッシュ＋長さを変更前後で比較（バイト一致なら回帰なし）。tsx 直実行は PptxGenJS の CJS interop で不可。
- トレードオフ：Radar はポリゴン塗りプリミティブが無くアウトラインのみ。残 Mermaid 4 型は画像のままだが、報告用途での頻度が低いため許容。override 書き戻しは `yaml.dump` 経由のためコメント/空行は非保持。

## References

- docs/ROADMAP.md（v4「ネイティブ図・グラフの大幅拡充」表、v5「Edit 専一・deck=真実」）
- src/engine/draw-target.ts（`DrawTarget` 抽象／`TransformedTarget`／`fitTransform`）
- src/engine/diagram-painter.ts（`paintDiagram` オーケストレーション、第2エンジン分岐、`paintFitted`）
- src/engine/svg-writer.ts（`SvgDrawTarget`／`renderDiagramToSvg`）、src/engine/pptx-writer.ts（`PptxDrawTarget`／`renderToBufferWithGroups`／`nestShapeXml`）
- src/engine/diagram-draw.ts・diagram-zones.ts（描画プリミティブ）、diagram-serialize.ts／mermaid-uml-parser.ts（往復変換）
- src/components/SlidePreview.tsx（ネイティブ優先・`MermaidDirect` フォールバック）、src/engine/placeholder-filler.ts（埋め込み書き出し）
- scripts/diagram-golden.ts（バイト一致ゴールデン）
- 開発メモリ: `diagram_render_architecture`, `diagram_format_architecture`, `tool_role_last_mile`, `guardrail_any_template`
