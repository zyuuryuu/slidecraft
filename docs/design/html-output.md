# スタンダロン HTML 出力 設計（磨いた Web preview を自己完結 HTML プレゼンへ）

- **Status**: **Proposed / Draft**（設計開始・未実装。2026-07-04）。実装スライス S1–S7 は未着手。
- **Date**: 2026-07-04
- **Related**: [ADR-0003](../adr/0003-diagram-pipeline.md)（図＝共有 painter・WYSIWYG・画像ゼロ／本設計はこの思想をスライド層へ延伸）／[ADR-0011](../adr/0011-placeholder-input-bijection.md)（役割バインドはレンダー1境界／HTML も同じ binding を呼ぶ）／[ADR-0002](../adr/0002-primary-surface-deck.md)（deck＝唯一の源・Markdown は入出力）／[ROADMAP テーマ1](../ROADMAP.md)（HTML 出力・大マイルストーン）
- **由来**: 設計調査ワークフロー（本セッション・8 エージェント：5 facet 調査＋3 敵対検証＋印刷/フォント再検証）→ ユーザ判断で「SSR 再利用 / MVP 優先 / Web 流の表現力を少し活かす」を確定。

> **対象**: 現行の `SlidePreview`（テンプレ由来の CSS 忠実描画）が画面に出しているスライドを、**インライン CSS/JS・スライド送りナビ・図/表/コード内蔵の 1 枚の `.html`** としてエクスポートする。PPTX 出力と**併存**（同じ deck・同じ template から 2 形式）。
>
> **写像可能性の結論**: `reuse-with-adaptation`。**中核は新規描画器を書かない**。図は `renderDiagramToSvg`（自己完結 SVG）を直接再利用、スライド本体は `SlideCard` を `react-dom/server` で SSR 再利用する。

---

## 1. 目的とハード制約

### 目的
PowerPoint 離れ・HTML プレゼンの潮流に対応し、**磨き込んだプレビューの見た目そのまま**を、受け取り手が PowerPoint 無しでブラウザで開ける 1 ファイルとして配布可能にする。

### ハード制約
- **C-WYSIWYG（この機能の価値）**: HTML のスライド**内容**は、画面の `SlidePreview` と**構造的に一致**させる。ズレる余地を作らない。
- **C-R2**: `src/engine/` は純粋（DOM/Tauri 禁止）。React・`mermaid.render`・SSR は `src/components/` 側に閉じる（[deck-export.ts](../../src/components/deck-export.ts) が既にこの位置取り）。
- **C-併存**: 既存 PPTX 出力パス（Toolbar → `handleGenerate` → `renderDeckToPptxBytes` → `generatePptx` → `saveBinaryFile`）を壊さず、同型の 4 ホップで足す。
- **C-自己完結**: 出力 `.html` は外部参照ゼロ（CDN/フォント/画像 URL なし）。スクリプト/スタイルはインライン。

---

## 2. 決定サマリ（ユーザ確定・2026-07-04）

| # | 決定 | 理由 |
|---|---|---|
| **D1** | **スライド描画＝`SlideCard` を SSR 再利用**（`react-dom/server` `renderToStaticMarkup`）。engine 内の第3描画器は作らない。 | プレビューと HTML が**同一コード**＝ドリフト**構造的に不可能**（図の `paintDiagram` 共有と同じ勝ち筋）。純粋エミッタは第3の独立描画器を生み、しかも Mermaid 問題（DOM 必須）を解決しない。 |
| **D2** | **v1 は MVP 優先（サイズ L）**。印刷用 `<text>` フォールバック・@font-face 埋め込み・オーバービュー等は後続。 | ブラウザ表示＋Ctrl-P 印刷（Win/Mac）で価値の大半が出る。堅牢化は測ってから。 |
| **D3** | **「体験層」は Web 流に磨く**（スライド遷移アニメ・上品なシェル）。ただし**スライド DOM は不変**、アニメは opacity/transform のみで reflow させない。 | HTML ならではの表現力を活かす一方、C-WYSIWYG（折返し凍結）を守る。 |
| **D4** | 既知の preview↔pptx 分岐（見出し太字・合成スライド番号・表色ハードコード）は**プレビュー基準**を採用。 | 目的が「磨いたプレビューに一致」ゆえ。PPTX とは一部異なる旨を明記。 |

---

## 3. 写像可能性の分析（2 層）

共有描画モデルは**2 層で成熟度が違う**。ここが設計の背骨。

### 3.1 図層 — 既に HTML/SVG レンダラ（直接再利用）
[svg-writer.ts:242](../../src/engine/svg-writer.ts) `renderDiagramToSvg(spec, opts)` は `paintDiagram`（PPTX と同一 painter）経由で**自己完結 SVG 文字列**を返す：外部参照なし・`<use>`/`<image>`/`href` なし・CSS クラスなし・ランタイムなし。矢印は手描き `<polygon>`（marker 非依存）、色/文字は `esc()`/`col()` でエスケープ済み。**ネイティブ 14 種は `mermaid.render` を一切踏まない**（`mermaidToDiagramSpec` で純関数変換 → `paintDiagram`）。
→ HTML はプレビューの [DiagramSvgOverlay.tsx:107-117](../../src/components/DiagramSvgOverlay.tsx) と同じく `renderDiagramToSvg(spec, {transparent, omitTitle, transform})` を呼び、返り値を該当ボックスに inline する。**新しい図描画コードはゼロ**。

### 3.2 スライド層 — 既に位置付き HTML/CSS（SSR で再利用）
[SlidePreview.tsx:117-380](../../src/components/SlidePreview.tsx) の `SlideCard` は**ほぼ純粋な prop→markup**で、全要素を**%指定の絶対配置 div/table**として吐く：背景・マスター/レイアウト装飾・静的テキスト・テキストプレースホルダ・ネイティブ `<table>`・コード。React state/hook を持つのは局所 2 経路のみ（`MermaidDirect`＝非同期、`DiagramSvgOverlay`＝ドラッグ）。**残りは全部 SSR で静的化できる**。
→ `renderToStaticMarkup(<SlideCard exportMode ... />)` で HTML 文字列化。

### 3.3 パリティの担保機構（既存）
`SlideCard` と PPTX は**共有バインディング関数群**で一致している：`autoSelectLayout`/`findLayout` → `buildCatalog` → `bindContentByRole`/`expandGroups` → `bodyPlaceholders`/`nthBody`（[SlidePreview.tsx:12-15](../../src/components/SlidePreview.tsx) と [placeholder-filler.ts](../../src/engine/placeholder-filler.ts) が同一 import）。HTML は `SlideCard` を丸ごと再利用するため、**この経路を自動的に共有**＝ preview↔html は同一コードで一致。

---

## 4. アーキテクチャ

```
Toolbar「書き出す ▸ 🌐 HTML」
  └► useDeckIO.handleExportHtml
        └► components/deck-html-export.ts  ← 新規オーケストレータ（React/DOM 可）
              1. preRenderMermaid(deck)            非ネイティブ mermaid(gitGraph/sankey/C4) → svgCache 注入
                                                   （既存 deck-export.ts:18-29 と同型／WebView 内で mermaid.render）
              2. per slide: renderToStaticMarkup(  各スライドを scale=96 の固定ステージで一度だけ SSR
                   <SlideCard exportMode slide layout .../>)
              3. assembleHtmlShell(slides[], deck) インライン CSS/JS・N ステージ・ナビ・遷移・印刷 CSS
        └► saveTextFile(html, "deck.html")         既存 dual-mode（Tauri 保存ダイアログ / ブラウザ DL）・新 IPC 不要
```

### 4.1 `SlideCard` の `exportMode` プロップ（1 コンポーネント 2 モード）
`exportMode` が立つとき：
- **編集 chrome を除去**: 選択枠（`isActive`/`selected` border・boxShadow [:148-149]）、`cursor:pointer`、`onClick`、合成スライド番号 div [:366-377]（番号はシェルのカウンタが担う）。
- **図は静的**: `DiagramSvgOverlay` を `editable={false}` で描画（既に `pointerEvents:none`＋同期 `useMemo(renderDiagramToSvg)` なので **SSR 安全**）。ドラッグハンドルは `editable` ゲートで出ない。
- **非ネイティブ Mermaid は svgCache を同期 inline**: `MermaidDirect` の非同期 `mermaid.render` を通さず、事前注入済み `svgCache` を `dangerouslySetInnerHTML` で出す（§5 の穴 A の対策）。

> `exportMode` は加算的。プレビュー（`exportMode` 無し）は完全に今日通り（byte-identical）。

### 4.2 スケーリング＝固定ステージ + CSS transform（reflow 凍結）
`SlideCard` は `scale`（px/inch）パラメトリック（[:131-132, :346](../../src/components/SlidePreview.tsx)）。**各スライドを `scale=96` で一度だけ SSR**（`SLIDE_W*96 = 1279.68px × 720px` のステージ）。外側シェルは CSS `transform: scale(container/1279.68)`（`transform-origin: top left`）でビューポートに合わせる。
- **原則**: React の `scale` プロップを**リサイズ毎に再計算しない**。一度組んだ DOM を CSS で光学的に拡大するだけ → **折返しが凍結**され、どの画面幅でもプレビュー（同じ `fontSize*(scale/72)` 式）と**同一の行分割**。これが C-WYSIWYG の肝。
- フォント px・border・%ジオメトリは `scale=96` で焼き込まれ、transform で一様スケール → 単位再導出ゼロ。

### 4.3 自己完結シェル
1 つの `.html` = `<style>`（インライン）＋ N 個の `<section class="slide">`（1 枚だけ `.active`）＋ `<script>`（インライン・約 40 行）。ルートは 16:9 ステージを中央レターボックス。各スライド内部は `SlideCard` の %絶対配置をそのまま使うので解像度非依存。

---

## 5. 確定した“要対応”ポイントと対策（コード実測済み）

| # | 穴 | 深刻度 | 対策 |
|---|---|---|---|
| **A** | **非ネイティブ Mermaid が SSR で空欄化**。[MermaidDirect:28-68](../../src/components/SlidePreview.tsx) は非同期 `useEffect`＋`mermaid.render`。`renderToStaticMarkup` は効果を実行せず空 div を出す。`mermaid.render` は DOM 必須で node 不可。 | 高 | §4.1 の事前描画＋同期 inline。対象は **gitGraph/sankey/C4 の細い裾のみ**（ネイティブ 14 種は §3.1 で同期描画）。事前描画は **WebView 内**で走る（deck-export.ts と同じ制約）。失敗時は空欄化でなく可視プレースホルダ＋警告。 |
| **B** | **編集 chrome の混入**（選択枠・ドラッグ・合成番号）。 | 中 | §4.1 `exportMode` で除去。 |
| **C** | **図テキストが全て `<foreignObject>`**（[svg-writer.ts:189-195](../../src/engine/svg-writer.ts)）。ブラウザ表示は問題なし。**印刷/PDF で消える恐れ**。 | 中 | **切り分けが肝**：canvas ラスタライズ（`canvas.drawImage`＝[mermaid.ts:14-16](../../src/components/mermaid.ts) の既知失敗）と、**ブラウザのネイティブ印刷は別経路**。Chromium(WebView2/Win)・WKWebView(macOS) は印刷でも foreignObject を描く → **Win/Mac の Ctrl-P は信頼可**。弱点は WebKitGTK(Tauri Linux)・一部他ブラウザ。**v1 はブラウザ表示前提で許容**、全エンジン PDF 堅牢化は後続の `<text>` フォールバック（§9）。※スライド**本文**テキストは素の `<div>` で安全＝危険は図テキストのみ。 |
| **D** | **CJK フォント非同梱**（テンプレ＝Yu Gothic/游明朝/MS Pゴシック）。 | 低 | 構造上低リスク（容量計算はフォント非依存 [template-catalog.ts:255-265](../../src/engine/template-catalog.ts)・`overflow:hidden` でクリップ・上流でスライド分割済み）。**v1 は順序付き CJK フォールバックスタック**（例：ゴシック `"Yu Gothic","Hiragino Kaku Gothic ProN","Noto Sans CJK JP","Meiryo",sans-serif`／明朝は明朝版）で、現状の素の `${fontFace},sans-serif`（Latin sans に落ちる唯一の醜いケース）を潰す。@font-face WOFF2 サブセット埋め込みは後続 opt-in。 |
| **E** | **シェル層の文字列連結でのインジェクション**。SSR 部分は React が自動エスケープするが、シェルが `<title>` 等に deck 由来文字列を素で入れると危険。 | 中 | シェルの deck 由来値は `svg-writer.ts` の `esc()` 相当でエスケープ。敵対テスト（`</title><script>` 等）を追加。 |

**フォント抽出の前提改善**（小・加算）: 現状 East-Asian フォント未抽出（[theme-extractor.ts:75-82](../../src/engine/theme-extractor.ts) は `<a:latin>` のみ）。`<a:ea>`/theme `<a:font script="Jpan">` を拾い `PlaceholderStyle.eaFontName?` を足すと、明朝 vs ゴシックのフォールバック分類が正しくなる。破壊的でない（optional フィールド）。

---

## 6. 体験層＝Web 流の表現力（D3）

**切り分けが設計原則**：スライドの**中身**は WYSIWYG 不変（プレビュー＝唯一の真実、一度 SSR したら DOM 不変）。磨くのは**プレゼン体験の層**だけ。アニメは opacity/transform に限定し、**レイアウトプロパティを触らない（reflow させない）**＝折返し凍結を保つ。

### MVP（v1 に含める）
- **スライド遷移**: `.active` 切替時の CSS transition。既定は上品なクロスフェード（`opacity` 150–200ms）。`data-transition` で `fade`/`slide`/`none` を切替可能に。
- **上品なシェル**: 進捗バー（下端の細線）、`n / N` カウンタ、全画面（`f`）、キーボードヒントの一瞬表示、レターボックス背景の質感。
- **HTML ならでは**: ベクター鮮明（PPTX のラスタ回避）、`#3` ディープリンク、`prefers-reduced-motion` で全アニメ無効化。

### 後続（v2 以降）
- リッチな遷移バリエーション（push/zoom）、**入場ビルド**（箇条書きの逐次表示等・要注意＝内容 DOM に触れるため慎重設計）、プレゼンターモード（ノート/次スライド）、自動再生。

> ガードレール: 遷移は**スライド境界**にのみ効く。個々のプレースホルダ内テキストのアニメは、内容 DOM を動かさない範囲（opacity のみ）に限る。ビルド系は「一度組んだ DOM の可視性トグル」に限定し、再レイアウトを禁止。

---

## 7. パリティ担保とテスト

**重要な含意**: D1（SSR 再利用）により **preview↔HTML はズレ得ない（同一コンポーネント）**。よってゴールデンの本当の仕事は **①外側シェル（スケール/ナビ/遷移/印刷 CSS）** と **②Mermaid 注入分岐** であって、`SlideCard` の markup 再検証ではない。

| テスト | 主張 |
|---|---|
| `html-export-slide-ssr.test.tsx` | `renderToStaticMarkup(<SlideCard exportMode/>)` が、代表 fixture（テキスト/表/コード/ネイティブ図/装飾/sparse/alien master）で **%位置ボックス**を含み、**選択枠/onClick/ドラッグハンドル/合成番号を含まない**。 |
| `html-export-mermaid-inject.test.tsx` | 非ネイティブ mermaid スライドが svgCache 事前注入で **空でない SVG** を出す（穴 A の回帰）。 |
| `html-export-shell.test.ts` | シェル assembler が N ステージ・`.active` 単一・ナビ script・`@page landscape` 印刷 CSS・遷移 CSS を含む。ネイティブ図 SVG は決定的（`renderDiagramToSvg` 純関数）。 |
| `html-export-injection.test.ts` | deck タイトル/テキストに `</section><script>`・fontColor `red" onload=` 等を入れても、シェル/属性に**生タグ/属性ブレイクアウトが出ない**（穴 E）。 |
| `html-export-transition.test.ts` | 遷移 CSS が `opacity`/`transform` のみ（`width`/`height`/`top`/`left` 等の reflow プロパティを含まない）。`prefers-reduced-motion` で無効化。 |

**テスト環境の注意**: 現行 vitest は `environment: 'node'`・`tests/**/*.test.ts` のみ（[vite.config.ts]）。SSR テスト（.tsx）用に **include に .tsx を追加**（必要なら jsdom プロジェクトを 1 つ）＝小さなハーネス変更。`mermaidIdCounter`（[:24](../../src/components/SlidePreview.tsx)）由来の非決定 id は、事前解決 SVG を渡す設計ゆえ**自動的に決定的**（or ハッシュ前に正規化）。

---

## 8. 段階実装計画（test-first・R3）

各スライスで先にテストを書く。**S1–S5 が MVP**、S6–S7 は後続。

- **S1 `exportMode` プロップ**: `SlideCard` に静的モード（chrome 除去・図を editable=false・合成番号ドロップ）。test: `html-export-slide-ssr`。
- **S2 Mermaid 事前描画**: `deck-html-export.preRenderMermaid`（[deck-export.ts:18-29](../../src/components/deck-export.ts) と同型）＋ `exportMode` の svgCache 同期 inline。test: `html-export-mermaid-inject`。
- **S3 シェル assembler**: 固定ステージ＋CSS `transform:scale` フィット＋ナビ JS（矢印/space/Home/End/`f`/クリック領域/`#hash`/カウンタ）＋印刷 CSS。test: `html-export-shell` + `html-export-injection`。
- **S4 体験層**: フェード遷移・進捗バー・`prefers-reduced-motion`。test: `html-export-transition`。
- **S5 配線**: `deck-html-export.ts` オーケストレータ ＋ Toolbar「🌐 HTML」項目 ＋ `useDeckIO.handleExportHtml` ＋ `saveTextFile`。App→useDeckController→useDeckIO を `handleGenerate` と並置。**手動/e2e 検証**：クリック→`.html`保存→ブラウザで開く→矢印で送り→Ctrl-P で 1 枚 1 ページ PDF。
- **S6 印刷堅牢化（✅ 完了・[ADR-0013](../adr/0013-svg-native-text.md)）**: `svg-writer.text()` を `<text>`/`<tspan>` に**全面統一し foreignObject を廃止**（フラグではなく統一＝preview/HTML/print/canvas が同一 SVG）。CJK≒1em/Latin≒0.55em の自前折返し（`wrapToWidth`）＋ `opts.shrink` の縮小（PPTX `fit:shrink` 準拠）で溢れ防止。→ 全エンジン/Linux/PDF で図テキスト保証。
- **S7 フォント埋め込み（後続）**: `<a:ea>` フォント抽出＋明朝/ゴシック分類、@font-face WOFF2 **サブセット**埋め込みの opt-in（数十 KB）。

---

## 9. スコープ分割（サイズ）

| フェーズ | 内容 | サイズ |
|---|---|---|
| **MVP（v1）** | SSR `SlideCard(exportMode)`＋固定ステージ CSS-scale＋ナビ＋フェード遷移＋進捗/カウンタ。**ネイティブ 14 種の図・表・コード・テキスト・装飾**。非ネイティブ mermaid 事前描画。ブラウザ表示＋Ctrl-P 印刷（Win/Mac）。CJK フォールバックスタック。シェルゴールデン。 | **L** |
| 後続 | 印刷用 `<text>` フォールバック（全エンジン/Linux PDF）、@font-face CJK サブセット埋め込み、オーバービューグリッド、リッチ遷移/入場ビルド/プレゼンターモード。 | 合計で XL |

---

## 10. 未解決・将来

- **印刷ターゲットの線引き**: Win/Mac Chromium/WebKit のみ（＝MVP）か、Linux/他ブラウザ/headless PDF を一級にするか（＝S6 必須）。実機（WebKitGTK）で foreignObject 印刷を実測してから確定。
- **フォント埋め込みの発火条件**: JP Windows 受信者が主なら不要、社外/クロス OS 配布が主ならサブセット埋め込みを標準化。1 本の実 CJK deck でファイルサイズを測ってから。
- **図フォント（theme.ts=Georgia/Calibri）とテンプレ抽出フォントの整合**: 現状プレビュー/PPTX も不整合。HTML は「プレビューと同じ SVG を埋める」ので悪化はしないが、将来テンプレ抽出フォントを `theme.fonts` に流す改善余地。
- **完成時に ADR-0013 を採番**（HTML 出力＝共有描画モデルのスライド層延伸・[ADR-0003](../adr/0003-diagram-pipeline.md) の系譜）。ROADMAP テーマ 1 から完了項目を除去。

---

## 11. References

- [ADR-0003](../adr/0003-diagram-pipeline.md) — 図パイプライン＝共有 painter・WYSIWYG（本設計はスライド層への延伸）
- [ADR-0011](../adr/0011-placeholder-input-bijection.md) — 役割バインドはレンダー 1 境界（HTML も同一 binding を呼ぶ）
- [ADR-0002](../adr/0002-primary-surface-deck.md) — deck＝唯一の源・Markdown は入出力
- 主な実装対象（予定）: `src/components/{deck-html-export.ts(新), SlidePreview.tsx(exportMode)}`、`src/components/{Toolbar.tsx, useDeckIO.ts, useDeckController.ts}`、（後続）`src/engine/{svg-writer.ts(<text>分岐), theme-extractor.ts(ea font)}`
- 再利用（無改変）: `src/engine/svg-writer.ts` `renderDiagramToSvg`、binding 群（`placeholder-binding`/`group-binding`/`template-loader`/`template-catalog`）、`src/ipc/commands.ts` `saveTextFile`
