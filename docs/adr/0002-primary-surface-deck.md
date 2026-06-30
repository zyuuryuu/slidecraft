# ADR-0002: 主面＝視覚 deck（Markdown は入出力のみ）

- **Status**: Accepted
- **Date**: 2026-06（v5「UX 統合」で実装完了）

## Context
本ツールの最終出力は PPTX であり、ユーザーが本当に見たいのは WYSIWYG のスライドである。にもかかわらず、当初は Markdown 編集（Import）と視覚編集（Edit）の 2 モードが併存し、双方が編集可能な「源」になっていた。この二重ソース構造が根本原因となり、二重 undo・二重書き戻し・ボタンの乱立（✨原稿を整形／→表・AIで直す／AIで整える が 3 面×2 モードに散在）を招いていた。「Import 画面の Markdown ペインを常時表示するか」という長年の Import vs Edit 論争を、原理で決着させる必要があった。

## Decision
- **唯一の源（single source of truth）＝ deck（`DeckIR` ＝ `SlideIR[]` ＋ geometry ＋ design）。** 起動時から視覚 Edit が主面であり、すべての編集はここに反映される。
- **Markdown は「入力」と「出力」に限定。** 入力は一度きりの **Initialize フェーズ（モーダル）**でのみ行い、原稿の持ち込み・スライド分割・各スライドの粗い内容だけを確定する。確定（確定 → Edit）後、deck は二度と mdText から再導出されない（`handleStartEditing` が parse→distill→`setDeck` で 1 回だけコミット）。
- **常設 Markdown ペインを撤去。** Edit/Import トグル・Open・Export MD ボタンを廃し、Markdown は Initialize モーダルへ閉じ込めた。再入場時は現 deck を `serializeMd(deck)` で直列化して見せる（deck → MD の一方向投影）。
- **undo は deck 履歴に一本化**（`useDeckController` / `useDocumentStore` の履歴）。整形レビュー・AI 修正・design 編集は、選択スライド上の **deck 操作**（undo 可能）として実行する。
- **AI 修正は非破壊・透明。** before→after 差分＋採用/却下を必須とし、無言適用・文章丸ごと Omit を禁止する。

## Consequences
- 二重ソース／二重 undo／二重書き戻しが消え、ボタン乱立の根本原因が解消。Edit が専一の編集 UI となる。
- `serializeMd` は **出力（ラウンドトリップアウト）専用**：ファイル保存（`useDeckIO`）、再 Initialize 入場時の投影、AI へ渡す per-slide 文脈の生成にのみ使う。日常編集の源には戻さない。
- 再 Import は「deck の置き換え」であり、警告付きの破壊的操作として扱う（MD-as-source への復帰ではない）。
- **Do-NOT-undo ガードレール**：(1) 常設 Markdown ペイン／3 ペイン編集を復活させない（第 2 の編集源を再導入してしまう）。(2) deck を mdText から継続的に再導出しない。(3) AI 修正を差分・採用/却下なしで自動適用しない。
- トレードオフ：Markdown を「ライブ協調ソース」として使う層には未対応。原稿の継続的な MD 編集は Initialize の再入場（deck 置き換え）を経由する必要がある。

## References
- docs/ROADMAP.md — 「v5 完了: UX 統合 — Edit 専一・deck=真実・Initialize モーダル」、および v3 統合 UI（E1〜E6）の設計思想（Markdown＝入出力／`SlideIR[]`＝唯一のモデル）
- src/App.tsx, src/components/InitializeModal.tsx — 視覚 Edit 主面＋ Initialize モーダルの配線
- src/components/useDeckController.ts — `handleStartEditing`（確定 → deck コミット）/ `handleEnterImport`（deck → MD 投影）/ deck＝唯一の源
- src/components/useHistoryState.ts, useDocumentStore — deck 一本化 undo/redo
- src/engine/slide-schema.ts — `SlideIR` / `DeckIR` 型定義
- src/engine/md-serializer.ts（`serializeMd`）, src/components/useDeckIO.ts — 出力／ラウンドトリップアウト
- 開発メモリ: `primary_surface_deck`, `ux_direction`（補足: `editing_two_stage`, `product_form_desktop`）
